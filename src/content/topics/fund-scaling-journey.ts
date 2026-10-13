import type { Topic } from '../../types';

const topic: Topic = {
  id: 'fund-scaling-journey',
  phase: 'fundamentals',
  order: 5,
  title: 'Scaling One App from 1 User to 1 Million (and Beyond)',
  subtitle:
    'One Indian D2C store on NestJS + Postgres, taken stage by stage from a single VM to multi-region. Each stage gives the metric that forces the change, the change itself, what it costs or breaks, and a diagram.',
  estimatedMinutes: 85,
  sources: [
    'Gaurav Sen — InterviewReady System Design course, "Building an Ecommerce App: 1 to 1M" (inspiration for the staged, analogy-first approach; all content here is original)',
    'Alex Xu — System Design Interview Vol 1, Ch 1 "Scale From Zero To Millions Of Users"',
    'AWS documentation — RDS Multi-AZ, read replicas, ALB idle timeout, S3/CloudFront, data transfer pricing pages (prices quoted are approximate list prices; check current)',
    'PostgreSQL documentation — declarative partitioning, pg_trgm, pg_stat_statements',
    'Citus documentation — distributed tables and co-location',
    'Digital Personal Data Protection Act, 2023 (India) — cross-border transfer provisions (context for multi-region)',
  ],
  tags: [
    'scaling',
    'scale-from-zero',
    'stateless',
    'load-balancer',
    'caching',
    'read-replicas',
    'cdn',
    'queues',
    'sharding',
    'multi-az',
    'multi-region',
    'cost',
  ],
  cheatSheet: [
    'Order of moves: split DB off → scale up → stateless app + LB → cache → replicas → CDN → queues → search offload → partition → (rarely) shard → multi-AZ (do it early) → multi-region (only for a reason).',
    'Each move needs a trigger metric, not a feeling: CPU > 70% at peak, p99 over SLO, DB reads > 80% of load, egress GB/day, queue-able work inside the request path, restore time > RTO.',
    '1M registered ≈ 150K DAU × ~80 API calls ≈ 12M/day ≈ 140 avg QPS, ~550 evening peak, ~2K on a sale day. A handful of pods handle it; the database and the sale spike are the real problems.',
    'Stateless app tier = no in-memory sessions, no local uploads, no per-instance cron, no sticky caches assumed correct. Only then can an LB and autoscaling work.',
    'Cache before replicas: a 95% hit ratio removes 95% of catalog reads; replicas only copy load and add read-after-write lag. Replicas are for reads you cannot cache (order history, reports).',
    'CDN for images and static: the win is latency in tier-2/3 cities and origin offload. Bytes cost roughly the same per GB at list price, so image resizing and WebP/AVIF are the real cost levers.',
    'Queues take side effects (email, WhatsApp, invoice PDF, courier booking) out of checkout: p99 drops and a vendor outage no longer fails orders. Use an outbox so no event is lost.',
    'Search: ILIKE "%term%" is a sequential scan. pg_trgm handles ~1M rows; past that, or for typo tolerance, synonyms and Hinglish, use OpenSearch fed by CDC.',
    'Partition append-heavy tables (events, notifications, order history) by time long before sharding. Most D2C apps at 1M users never need to shard.',
    'Multi-AZ is cheap insurance; do it once revenue depends on uptime. Multi-region needs a reason (DR RTO, residency, latency for non-India users) and doubles operational complexity.',
  ],
  sections: [
    {
      heading: 'The running example and the pizza-shop map of the whole journey',
      body: `**Intuition first.** Picture a pizza shop. On day one the owner takes orders, cooks, packs and handles the cash, all in one room. As customers grow you do not build a factory overnight. You fix whatever is overloaded at that moment: a separate storeroom, a bigger oven, more cooks following the same recipe, a counter of pre-made bases, delivery kiosks near customers, an order rail for the back kitchen, a second kitchen on a different power line. Software scaling works the same way: **each change is a response to one measured bottleneck**, and each one costs money and adds a new way to fail.

**The running example.** *DesiCart* (fictional) is a D2C brand selling ethnic wear and home goods across India: a React storefront, a NestJS monolith, Postgres, and Razorpay for payments. Orders ship through a courier aggregator. Traffic is very spiky: the evening peak (8–10 PM) is about 4× the daily average, and festive sales (Diwali, End of Reason Sale-style events) reach 15–20× for a few hours.

**Workload at 1M registered users** (the target we size towards):
- About 15% are daily active: **150K DAU**. Each produces about 80 API calls a day (a page view triggers several), so 12M calls/day, **≈ 140 QPS on average, ≈ 550 QPS at the evening peak, ≈ 2K QPS during a sale**.
- Conversion is about 2% of DAU, so roughly **3K orders/day** normally and 30–50K on a sale day.
- Catalog: 50K SKUs, about 6 images each. Reads outnumber writes by about 50:1.

The point of these numbers: 2K QPS is **not** big-tech scale. A few pods serve it. What actually hurts is the database under bad queries, the sale spike arriving within minutes, images on slow mobile networks, and side effects inside checkout. The stages below follow the order in which those pains usually show up.

| Stage | Users (rough) | Trigger that forces it | Change |
|---|---|---|---|
| 0 | 1–1K | — | One VM: Nest + Postgres + files |
| 1 | 1K–10K | App and DB fight for CPU/RAM; backups on the same disk | Managed Postgres, separate box |
| 2 | 10K–50K | CPU > 70% at peak | Bigger instances, Node cluster mode |
| 3 | 50K–200K | Deploys cause downtime; one box = SPOF; sale spikes | Stateless app + LB + autoscaling |
| 4 | 100K–500K | DB CPU from repeated catalog reads | Redis cache-aside |
| 5 | 300K–1M | Uncacheable reads (history, reports) | Read replica(s) |
| 6 | 200K+ | Image egress, slow tier-2 page loads | CDN + object storage |
| 7 | 200K+ | Checkout p99 dominated by side effects | Queues + workers + outbox |
| 8 | 500K+ | Search slow and dumb | pg_trgm → OpenSearch |
| 9 | 1M → 10M+ | Huge append tables; write/WAL ceiling | Partition → shard |
| 10 | Revenue-critical | An AZ outage = full outage | Multi-AZ everything |
| 11 | Beyond | RTO, residency, global users | Multi-region (active-passive first) |

**How to use this in an interview.** "Scale from zero to a million" is either asked outright or hides inside every design question as "how would this evolve?". Strong answers name the **trigger metric** before the change and the **new failure mode** after it. Weak answers list technologies.`,
      diagram: `  Pizza shop                         DesiCart
  -----------------------------      ---------------------------------------
  owner does everything        -->   1 VM: Nest + Postgres + uploads
  separate storeroom           -->   managed Postgres on its own box
  bigger oven                  -->   vertical scaling
  more cooks + front counter   -->   stateless pods behind a load balancer
  pre-made bases on the shelf  -->   Redis cache
  photocopies of the menu      -->   read replicas
  kiosks near customers        -->   CDN for images/static
  order rail for back kitchen  -->   queues + workers
  a menu expert at the door    -->   search engine
  storerooms per neighbourhood -->   partitioning / sharding
  second kitchen, other grid   -->   multi-AZ
  kitchen in another city      -->   multi-region`,
      keyPoints: [
        'Every stage is a response to one measured bottleneck, never a pre-emptive wishlist.',
        '1M registered users is about 2K QPS at sale peak: modest compute, real database and spike problems.',
        'State the trigger metric, the change, and the new failure mode for each step.',
      ],
      source: 'Inspired by Gaurav Sen (InterviewReady) "1 to 1M" and Alex Xu Vol 1 Ch 1; numbers are original estimates',
    },
    {
      heading: 'Stages 0–1 — One box, then split the database off (1 to ~10K users)',
      body: `**Pizza shop:** the owner cooks, takes orders and keeps the flour under the counter. That is perfectly sensible on day one.

**Setup.** One VM (4 vCPU, 16 GB, about $140/month on demand in Mumbai) runs Docker Compose with NestJS, Postgres and an nginx reverse proxy with TLS. Product images live on the local disk. A cron job dumps Postgres nightly to the same disk.

**Why this is right at the start.** Traffic is maybe 1–5 requests/s. The founder needs features, not architecture. One box is easy to reason about, cheap, and fast to debug: \`docker logs\` and \`htop\` are your observability stack. A NestJS endpoint doing one or two indexed queries serves hundreds of requests per second per core, so compute is not the issue.

**What breaks and the trigger metrics**
- **Resource fights:** a slow admin report query pins Postgres at 100% CPU, and the Node process on the same box starves, so checkout times out. *Trigger: correlated CPU spikes between the app and DB processes, or p99 > 1 s whenever someone runs a report.*
- **Deploys mean downtime:** \`docker compose up -d\` restarts the app for 5–20 s, and the shop is offline during it.
- **Backups on the same disk:** losing the disk loses the data and the backup together. *Trigger: you have revenue. RPO is "since last night" at best, "forever" at worst.*
- **Disk filling up** with images and logs at 3 AM.

**Observability and cost at this stage.** Uptime ping (UptimeRobot or similar), error tracking (Sentry), and a disk-usage alert at 80%. Cost: about ₹12K/month. People: 1 engineer.

### Then Stage 1 — separate the database (1K to ~10K users)

**Pizza shop:** the flour moves out from under the counter into a proper storeroom with a lock, a thermometer and someone who restocks it.

**Trigger metrics.** Postgres and Node regularly compete: combined CPU above 60–70% at the evening peak, OOM-killer events, or the first scare where a disk issue nearly lost orders. Also any business requirement such as "we can lose at most 5 minutes of orders" (RPO 5 min), which a nightly dump cannot meet.

**The change.** Move to managed Postgres (RDS or Aurora PostgreSQL; Cloud SQL or a managed provider elsewhere) on its own instance, for example 2 vCPU / 8 GB to start. You get:
- **Automated backups plus point-in-time recovery** (RPO measured in minutes), and snapshot restores you can test.
- **Independent sizing**: the app box can be compute-optimised and the database memory-optimised.
- **Ops offloaded**: minor-version patching, storage autoscaling and monitoring dashboards.

**What it costs and what breaks**
- **A network hop**: every query now costs about 0.3–1 ms of network RTT inside a region. An N+1 endpoint issuing 200 queries goes from 20 ms to 150 ms. *Fix the N+1 before blaming the move.*
- **Connections are now a budget.** Managed Postgres has a max_connections tied to instance memory. Size the pg pool deliberately (10–20 per process) and set statement and idle timeouts.
- **Security**: the database should sit in a private subnet, with TLS on connections and credentials in a secret manager.
- Cost rises to roughly ₹25–35K/month.

**Observability added.** DB CPU, free memory, connections, replication slot or storage growth, and slow-query logging (\`log_min_duration_statement = 500ms\`) plus **pg_stat_statements**. This is the single most useful tool for the next three stages.

→ Go deeper: db-connections-locks §1–§3 (why connections are expensive and how to size pools), db-indexing §7 (finding the queries worth fixing).`,
      code: [
        {
          language: 'yaml',
          title: 'Stage 0 docker-compose.yml — honest, cheap, and full of single points of failure',
          code: `services:
  api:
    build: .
    environment:
      DATABASE_URL: postgres://app:app@db:5432/desicart
      UPLOAD_DIR: /data/uploads          # images on local disk: fine now, a blocker at stage 3
    volumes:
      - uploads:/data/uploads
    depends_on: [db]
    restart: unless-stopped
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app             # move to a secret manager before anyone else joins
      POSTGRES_DB: desicart
    volumes:
      - pgdata:/var/lib/postgresql/data  # same disk as everything else
    restart: unless-stopped
  proxy:
    image: nginx:1.27
    ports: ['80:80', '443:443']
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - uploads:/var/www/uploads:ro      # nginx serves images straight off the disk
    depends_on: [api]
volumes:
  uploads: {}
  pgdata: {}`,
        },
        {
          language: 'typescript',
          title: 'A pg pool that respects the new network boundary',
          code: `import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,         // private endpoint of managed Postgres
  ssl: { rejectUnauthorized: true, ca: process.env.RDS_CA_PEM },
  max: 15,                          // per process; (pods x processes x max) must stay under max_connections
  idleTimeoutMillis: 30_000,        // release idle sockets
  connectionTimeoutMillis: 2_000,   // fail fast when the pool is exhausted instead of queueing forever
  statement_timeout: 5_000,         // server kills runaway queries (admin reports!)
  idle_in_transaction_session_timeout: 10_000, // a forgotten BEGIN cannot hold locks for hours
  application_name: 'desicart-api', // shows up in pg_stat_activity: who is doing what
});

pool.on('error', (err) => {
  // an idle client errored (e.g. failover); log and let the pool replace it
  console.error('pg pool error', err.message);
});`,
        },
      ],
      diagram: `  STAGE 0
  users --HTTPS--> [ VM: nginx -> NestJS -> Postgres ]
                         |           |          |
                      /uploads   app logs   pgdata + nightly dump
                     (same disk, same box, same failure)

  STAGE 1
  users --> [ VM: nginx -> NestJS ] --TLS, private--> [ Managed Postgres ]
                       |                               | automated backups
                    /uploads                           | PITR (RPO ~5 min)`,
      keyPoints: [
        'Stage 0 is the correct choice for 1–1K users: speed of iteration beats architecture.',
        'First triggers: app/DB CPU contention, deploy downtime, backups on the same disk.',
        'Stage 1 trigger: resource contention or an RPO that nightly dumps cannot meet; managed Postgres buys PITR and independent sizing.',
        'New costs: a network hop per query (N+1 hurts more) and a connection budget.',
        'Observability: uptime ping, error tracking, disk alert; then pg_stat_statements, which drives the next several stages.',
      ],
    },
    {
      heading: 'Stage 2 — Vertical scaling and where it stops (10K to ~50K users)',
      body: `**Pizza shop:** buy a bigger oven. It is the fastest fix, needs no new process, and you can do it this weekend.

**Trigger metrics.** App-box CPU above 70% at the evening peak, or the Node event-loop lag p99 above 100 ms. On the database: CPU above 70%, or the working set no longer fitting in RAM (buffer cache hit ratio falling below about 99%, and read IOPS climbing).

**The change**
- **Node uses one core per process.** A 4-vCPU box running one Node process wastes 3 cores. Use PM2 cluster mode or the Node cluster module with one worker per core. Throughput scales roughly linearly with workers until the database becomes the limit.
- **Scale up the instances.** The app goes from 4 to 8 vCPU. The database goes from 8 GB to 32 GB RAM so the hot data fits in memory. Each step is roughly 2× the price.

**Where vertical scaling stops**
| Limit | Why it bites |
|---|---|
| Price curve | Doubling size doubles cost, and the largest instances cost a premium per core |
| Hard ceiling | The biggest single instance is finite, and you reach it at the worst moment (sale day) |
| Still one box | One app VM is a single point of failure: every deploy, kernel patch or hardware fault is an outage |
| Resizing needs a restart | Changing the instance class means downtime or a failover |
| Spikes are faster than resizes | A Diwali spike arrives in 3 minutes; resizing takes 10–20 |

**Interview line:** "Scale up first, because it is cheap in engineering time. I'd move to a horizontal app tier as soon as deploys need to be zero-downtime or a single box becomes an availability risk, which for a revenue-generating store is early."

**Observability added.** Event-loop lag (\`perf_hooks.monitorEventLoopDelay\`), per-worker memory, and a RED dashboard (rate, errors, duration) per route. Cost: roughly ₹50–70K/month.`,
      code: [
        {
          language: 'javascript',
          title: 'ecosystem.config.js — use every core before buying more boxes',
          code: `module.exports = {
  apps: [
    {
      name: 'desicart-api',
      script: 'dist/main.js',
      exec_mode: 'cluster',      // one OS process per worker, sharing port 3000
      instances: 'max',          // = number of vCPUs; each worker has its own event loop
      max_memory_restart: '1G',  // a leaking worker is recycled instead of OOM-killing the box
      kill_timeout: 15000,       // give in-flight requests time on reload
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        // pool max per worker: 8 workers x 15 = 120 connections. Check max_connections!
        PG_POOL_MAX: '15',
      },
    },
  ],
};
// 'pm2 reload desicart-api' restarts workers one by one: the first taste of zero-downtime deploys,
// but it is still a single machine, so a kernel patch or hardware fault is still an outage.`,
        },
      ],
      diagram: `  users --> [ VM 8 vCPU: nginx -> PM2 x8 ] --> [ Postgres 32 GB RAM ]
                   ^ still one box                ^ still one primary
                   | every patch = outage risk    | biggest size = ceiling`,
      keyPoints: [
        'Node needs one process per core; cluster mode is free throughput.',
        'Scale up the DB until the working set fits in RAM.',
        'Vertical scaling stops at price, the instance ceiling, SPOF, resize downtime and spike speed.',
      ],
    },
    {
      heading: 'Stage 3 — Stateless app tier behind a load balancer (50K to ~200K users)',
      body: `**Pizza shop:** hire more cooks, give them all the same recipe card, and put a person at the front counter who hands each order to whichever cook is free. That only works if no cook keeps private notes in their apron pocket, such as "table 4 wanted extra cheese".

**Trigger metrics.** Any one of: the business needs **zero-downtime deploys** (several releases a day); one box at more than 60% CPU at normal peak, leaving no room for a 10× sale; or the first outage from a single instance (a hardware retirement notice, a bad kernel).

**The change**
1. **A load balancer** (ALB or nginx/HAProxy pair) in front of N identical app instances, on an autoscaling group or Kubernetes Deployment, minimum 3 across availability zones.
2. **Make the app stateless.** This is the real work:
   - **Sessions:** JWT access tokens with refresh tokens, or server sessions in Redis. Never an in-memory map.
   - **Uploads:** to S3 via presigned URLs (stage 6 builds on this). Never to local disk.
   - **Scheduled jobs:** run them once, through a scheduler or a leader lock. With 6 pods, a plain @Cron runs 6 times and sends 6 "your order shipped" messages.
   - **In-memory caches:** fine as an optimisation, never as the source of truth, and each pod's copy may differ.
   - **WebSocket or SSE connections**, if any: these are stateful by nature, so plan sticky routing plus a pub/sub backbone.
3. **Health checks:** readiness (can serve traffic: DB reachable, warm) is separate from liveness (the process is not wedged). Add graceful shutdown on SIGTERM to drain in-flight requests.

**What it costs and what breaks**
- **Connection explosion:** 10 pods × 8 workers × 15 = 1,200 connections against a database that allows 500. Shrink per-process pools or add PgBouncer in transaction mode.
- **LB timeouts:** the ALB idle timeout (60 s by default) now limits long requests. Anything slow has to become async (stage 7).
- **Debugging spans machines:** you need centralised logs with a request id. \`ssh\` + \`tail\` no longer works.
- Cost: LB about $20–40/month plus data processing, and at least 3 instances.

**Observability added.** Centralised structured logs (Loki or CloudWatch) with a correlation id, a per-target LB 5xx rate, healthy-host count, and an autoscaling activity log.

→ Go deeper: fund-scalability §2 (stateless vs stateful), net-load-balancing §5 and §8 (health checks, draining), deployment-infra §4 and §10 (probes, graceful shutdown).`,
      code: [
        {
          language: 'nginx',
          title: 'Self-managed variant: nginx as the LB with health-aware upstreams',
          code: `upstream desicart_api {
    least_conn;                                  # better than round-robin when request costs vary
    server 10.0.1.11:3000 max_fails=3 fail_timeout=10s;
    server 10.0.2.12:3000 max_fails=3 fail_timeout=10s;
    server 10.0.3.13:3000 max_fails=3 fail_timeout=10s;
    keepalive 64;                                # reuse upstream TCP connections
}

server {
    listen 443 ssl http2;
    server_name api.desicart.example;

    location / {
        proxy_pass http://desicart_api;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header X-Request-Id $request_id;   # correlation id for centralised logs
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 2s;
        proxy_read_timeout 30s;                       # long work must go async, not wait here
        proxy_next_upstream error timeout http_502 http_503;
        proxy_next_upstream_tries 2;                  # retry once on another node, only for safe failures
    }
}`,
        },
      ],
      diagram: `                     +--> [ api pod AZ-a ] --+
  users --> [ LB ] --+--> [ api pod AZ-b ] --+--> [ Postgres primary ]
             health  +--> [ api pod AZ-c ] --+--> [ Redis: sessions, locks ]
             checks        no local state         + S3 for uploads`,
      keyPoints: [
        'Trigger: zero-downtime deploys, SPOF risk, or no headroom for sale spikes.',
        'Stateless means no in-memory sessions, local uploads, per-pod cron or authoritative local caches.',
        'New failure modes: connection explosion, LB timeouts, debugging across machines.',
        'Readiness ≠ liveness; drain on SIGTERM.',
      ],
    },
    {
      heading: 'Stage 4 — Caching the hot reads (100K to ~500K users)',
      body: `**Pizza shop:** the most-ordered pizza is a margherita. Instead of kneading dough for every order, keep a shelf of pre-made bases. 80% of orders start from the shelf, and the kneading station stops being the bottleneck.

**Trigger metrics.** DB CPU above 60–70% at peak with app pods idle, and **pg_stat_statements shows the top queries are the same catalog reads** (product by id, category listing, home banners) run millions of times a day. Typically 90%+ of DB time is reads of data that changes a few times a day.

**First, the free win.** Before caching, fix the top 5 queries in pg_stat_statements: add the missing composite index, remove N+1s in the GraphQL or REST layer, and select only the columns you need. This often cuts DB CPU by half.

**The change: Redis cache-aside**
- Cache **product documents** (TTL 10–30 min, invalidated on write), **category listing pages** (TTL 60 s), and **home banners and config** (TTL 5 min).
- **Do not cache** price and stock at checkout. Read those fresh from the primary, because they decide money.
- **Size it.** 50K SKUs × about 4 KB per product document is about 200 MB, so a small Redis node (1–2 GB) with a replica is enough.
- **Effect.** At 2K QPS on a sale day with 95% of reads cacheable at a 95% hit ratio, Postgres sees roughly 2,000 × (0.05 + 0.95 × 0.05) ≈ 200 QPS instead of 2,000.

**What it costs and what breaks**
- **Staleness:** a price change appears up to one TTL late on listing pages. Decide whether that is acceptable per field, and invalidate on write.
- **Stampede at sale start:** all keys expire or get purged together, so the database sees a cold-cache flood at the worst moment. Pre-warm before the sale and add jittered TTLs.
- **A new dependency:** if Redis is down, do not fall through to the database at full rate. Use a circuit breaker plus a small in-process fallback cache.

**Observability added.** Hit ratio per key prefix, Redis memory and evictions, command latency p99, and DB QPS before and after.

→ Go deeper: cache-fundamentals §1 and §3 (hit-ratio math, cache-aside), cache-failures §3 and §5 (stampede, avalanche), cache-failures §8 (Redis is down).`,
      code: [
        {
          language: 'typescript',
          title: 'ProductService: cache-aside with version-bump invalidation (no delete races)',
          code: `import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { Pool } from 'pg';

@Injectable()
export class ProductService {
  constructor(private readonly redis: Redis, private readonly pool: Pool) {}

  // Key includes the product's version; a write bumps the version so old entries simply age out.
  async getProduct(id: string) {
    const ver = (await this.redis.get('pver:' + id)) ?? '0';
    const key = 'product:' + id + ':v' + ver;
    const hit = await this.redis.get(key);
    if (hit) return JSON.parse(hit);

    const { rows } = await this.pool.query(
      'SELECT id, title, description, images, mrp, rating_avg FROM products WHERE id = $1', [id],
    );
    if (!rows[0]) {
      await this.redis.set(key, 'null', 'EX', 60); // negative cache: bots probing random ids
      return null;
    }
    const ttl = 1800 + Math.floor(Math.random() * 300); // 30 min + jitter
    await this.redis.set(key, JSON.stringify(rows[0]), 'EX', ttl);
    return rows[0];
  }

  async updateProduct(id: string, patch: { title?: string; description?: string }) {
    await this.pool.query(
      'UPDATE products SET title = COALESCE($2, title), description = COALESCE($3, description) WHERE id = $1',
      [id, patch.title ?? null, patch.description ?? null],
    );
    await this.redis.incr('pver:' + id); // after commit: readers move to a fresh key immediately
  }
}`,
        },
      ],
      diagram: `  pods --GET product--> [ Redis ] --hit 95%--> response
                           | miss 5%
                           v
                     [ Postgres primary ]  <-- writes bump pver:{id}
  DB read load: 2,000 QPS --> ~200 QPS`,
      keyPoints: [
        'Trigger: DB CPU dominated by repeated reads of slow-changing data.',
        'Fix the top queries first; then cache-aside the catalog, never checkout price or stock.',
        'Version-bump keys avoid delete-then-refill races.',
        'Plan for stampede at sale start and for Redis being down.',
      ],
    },
    {
      heading: 'Stage 5 — Read replicas for the reads you cannot cache (300K to ~1M users)',
      body: `**Pizza shop:** make photocopies of the order book for the accountant and the delivery manager, so they stop queueing at the cashier's desk to read the original. The copies are a few minutes behind, which is fine for a monthly report and wrong for "did my order go through?".

**Trigger metrics.** After stage 4, the primary is still above 60% CPU, and the load comes from **reads that are per-user or analytical** and therefore cache poorly: "My Orders" history, seller and ops dashboards, finance exports, recommendations queries. Or one heavy reporting query visibly spikes p99 for checkout.

**The change.** Add one or two asynchronous streaming replicas. Route by **intent**, not by HTTP verb:
- **Primary:** all writes, checkout, payment callbacks, and any read within a few seconds of the same user's write.
- **Replica:** order history (with a read-your-writes guard), admin listings, and a reporting replica with longer statement timeouts so analysts cannot hurt production.

**What it costs and what breaks**
- **Replication lag.** It is usually under 100 ms, but it spikes to seconds or minutes during bulk updates, vacuum, or long queries on the replica (hot_standby_feedback trade-offs). The classic bug: a user places an order, is redirected to My Orders, and the order is missing.
- **No write relief.** Replicas replay every write, so write capacity is unchanged.
- **Failover semantics.** In a Multi-AZ setup the standby is synchronous for durability; read replicas are separate and asynchronous. Know which endpoint your app uses.
- Cost: each replica costs about the same as the primary.

**Observability added.** Replica lag in seconds and bytes (\`pg_stat_replication\`, \`replay_lag\`), a query-routing ratio (the share of reads on replicas), and an alert when lag exceeds your read-your-writes window.

→ Go deeper: db-replication §5–§7 (routing, read-after-write, lag), prod-scale §5 (the "my update disappeared" incident).`,
      code: [
        {
          language: 'typescript',
          title: 'Route by intent with a read-your-writes window',
          code: `import { Pool } from 'pg';
import Redis from 'ioredis';

const primary = new Pool({ connectionString: process.env.DB_PRIMARY_URL, max: 10 });
const replica = new Pool({ connectionString: process.env.DB_REPLICA_URL, max: 10 });
const redis = new Redis(process.env.REDIS_URL!);
const RYW_WINDOW_SEC = 5; // must exceed replica lag p99; alert if lag gets close

export async function markUserWrote(userId: string) {
  // set right after a committed write (order placed, address changed)
  await redis.set('ryw:' + userId, '1', 'EX', RYW_WINDOW_SEC);
}

export async function poolForRead(userId: string | null, opts: { mustBeFresh?: boolean } = {}) {
  if (opts.mustBeFresh) return primary;              // checkout price/stock, payment status
  if (userId && (await redis.exists('ryw:' + userId))) return primary; // recently wrote: avoid stale view
  return replica;
}

// usage in OrdersController.list():
//   const db = await poolForRead(user.id);
//   const { rows } = await db.query('SELECT ... FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 20', [user.id]);`,
        },
      ],
      diagram: `         writes, fresh reads        async WAL stream
  pods ---------------------> [ primary ] -------+--> [ replica 1: app reads ]
    \\                                            +--> [ replica 2: reports ]
     \\-- history, dashboards (after RYW) -------^       longer timeouts`,
      keyPoints: [
        'Trigger: primary still hot from per-user or analytical reads that do not cache well.',
        'Route by intent; keep checkout and just-written data on the primary.',
        'Replication lag is the new bug class; replicas add zero write capacity.',
        'A dedicated reporting replica protects production from analysts.',
      ],
    },
    {
      heading: 'Stage 6 — CDN and object storage for images and static assets (200K+ users)',
      body: `**Pizza shop:** cold drinks and desserts do not need the chef. Put self-serve kiosks near the customers' neighbourhoods, stocked from a central warehouse.

**Trigger metrics**
- **Image egress:** 150K DAU × about 60 images per day × about 50 KB is roughly **450 GB/day, or 13.5 TB/month**, much of it served by app pods or nginx from disk.
- **Page load in tier-2 and tier-3 cities:** LCP above 3–4 s on 4G because every image travels from Mumbai.
- **App CPU and bandwidth** spent on bytes that never change.
- After stage 3, local-disk uploads no longer work at all: a file uploaded to pod A does not exist on pod B.

**The change**
1. **Objects in S3** (or any object store). Sellers and admins upload via presigned URLs, so the bytes never pass through the API.
2. **CDN in front** (CloudFront, Cloudflare, Akamai, Bunny). Use content-hashed URLs for JS/CSS and images (\`/img/sku123/ab12f.webp\`) with \`Cache-Control: public, max-age=31536000, immutable\`. Changing an image means a new URL, so no purge is needed.
3. **Image transformation at the edge or origin:** resize to device width and serve WebP or AVIF. This often cuts bytes by 40–70%, which is the actual cost lever.

**The cost nuance interviewers like.** At list prices, CDN egress in India is **not obviously cheaper per GB** than origin egress (roughly $0.17/GB for CloudFront India against about $0.11/GB for EC2 internet egress from Mumbai, both for the first 10 TB; check current pricing). At 13.5 TB/month that is about $2.3K against $1.5K. The CDN is justified by **latency, origin offload and resilience during sales**. The bill comes down through **fewer bytes** (resizing, modern formats, lazy loading), committed-use discounts, or a cheaper CDN.

**What it costs and what breaks.** Cache-key mistakes (query strings or cookies varying the key) collapse the hit ratio. Personalised pages must not be cached publicly. Signed URLs are needed for private files such as invoices.

**Observability added.** CDN hit ratio (target > 95% for images), origin requests/s, bytes saved by format, and real-user LCP by city tier.

→ Go deeper: cdn-global §3–§5 (headers, invalidation, origin shield), object-storage §7 and §10 (presigned URLs, CDN in front of storage).`,
      diagram: `  browser --img--> [ CDN edge: Delhi, Chennai... ] --miss--> [ S3 origin ]
     |                  ~95% hits served here                 ^
     |                                                        | presigned PUT
     +--API--> [ LB -> pods ] -- sign upload URL -------------+
                 (no image bytes through pods any more)`,
      keyPoints: [
        'Trigger: GB/day of static egress, slow LCP outside metros, local uploads breaking with multiple pods.',
        'Content-hashed immutable URLs remove the need for purges.',
        'CDN wins on latency and offload; resizing and WebP/AVIF win on cost.',
        'Watch cache-key hygiene: query strings and cookies destroy hit ratios.',
      ],
    },
    {
      heading: 'Stage 7 — Async work via queues: take side effects out of checkout (200K+ users)',
      body: `**Pizza shop:** the cashier used to wait while the chef cooked, the packer packed and the delivery boy was called, so each customer took 15 minutes at the counter. Now the cashier pins an order ticket on a rail and serves the next customer. The kitchen works through the rail at its own pace, and a broken phone line to the delivery agency no longer stops the cashier.

**Trigger metrics.** Checkout p99 is 2.5 s, and traces show 1.8 s of it is *not* the order: sending the email, the WhatsApp confirmation via a BSP API, generating a GST invoice PDF, booking the courier, and firing analytics events. Worse, **when the SMS vendor is down, checkouts fail**. Other signs: request timeouts on bulk admin actions, and cron jobs that take longer than their interval.

**The change**
- **Checkout does only what the customer must wait for:** validate, reserve stock, create the order and payment intent, commit. In the same transaction it writes **outbox rows** (order.created).
- **A relay** publishes outbox rows to a queue (BullMQ on Redis at this scale, or SQS/RabbitMQ; Kafka once many consumers need replay).
- **Workers per job class:** notifications, invoice PDFs, courier booking, analytics. Each has retries with backoff, a DLQ and **idempotent handlers**, since delivery is at-least-once.
- **Load levelling on sale day:** 30K orders in an hour do not have to mean 30K PDFs generated in that hour. The queue absorbs the burst and workers autoscale on queue age.

**What it costs and what breaks**
- **Eventual consistency in the UI:** "invoice will be emailed shortly". The order page needs states such as "invoice generating".
- **New failure modes:** poison messages, DLQs that nobody watches, duplicates (two confirmation SMS messages), and ordering (a "shipped" notification before "confirmed"). Use a per-order key or check the state before sending.
- **Operational load:** queue depth, oldest-message age and DLQ size become paging metrics.

**Observability added.** Per-queue depth, age of the oldest job, processing rate, failure and DLQ counts, and end-to-end lag from order created to notification sent.

→ Go deeper: mq-scenarios §2–§3 (202 Accepted, load levelling), ds-transactions §8 (outbox), mq-scenarios §7–§8 (idempotent consumers, DLQ).`,
      code: [
        {
          language: 'typescript',
          title: 'Outbox relay: Postgres rows to BullMQ, safe across multiple pods',
          code: `import { Pool } from 'pg';
import { Queue } from 'bullmq';

const queues: Record<string, Queue> = {
  'order.created': new Queue('notifications', { connection: { url: process.env.REDIS_URL! } }),
  'order.paid': new Queue('invoices', { connection: { url: process.env.REDIS_URL! } }),
};

// Runs in every pod; SKIP LOCKED lets pods share the outbox without double-publishing a row.
export async function relayOnce(pool: Pool, batch = 200) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT id, type, aggregate_id, payload FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED',
      [batch],
    );
    for (const r of rows) {
      const q = queues[r.type];
      if (!q) continue;
      // jobId = outbox id: if we crash after add() but before COMMIT, the re-add is a no-op in BullMQ
      await q.add(r.type, { orderId: r.aggregate_id, ...r.payload }, {
        jobId: 'outbox-' + r.id, attempts: 8, backoff: { type: 'exponential', delay: 5_000 },
      });
    }
    if (rows.length) {
      await client.query('UPDATE outbox SET published_at = now() WHERE id = ANY($1)', [rows.map((r) => r.id)]);
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}`,
        },
      ],
      diagram: `  checkout --> [ BEGIN: order + stock + outbox row; COMMIT ] --> 201 in ~300 ms
                                   |
                         relay (SKIP LOCKED)
                                   v
        [ queue: notifications ] [ queue: invoices ] [ queue: courier ]
                 |                      |                    |
            workers (retry, DLQ, idempotent by order id)`,
      keyPoints: [
        'Trigger: side effects dominate request latency, or vendor outages fail core flows.',
        'Keep only must-wait work in the request; write an outbox row in the same transaction.',
        'At-least-once delivery: idempotent handlers, DLQs with owners, per-class queues.',
        'Queues double as load levellers on sale day.',
      ],
    },
    {
      heading: 'Stage 8 — Offload search from Postgres (500K+ users)',
      body: `**Pizza shop:** customers keep asking the cashier "do you have something spicy without onion?". The cashier flips through every recipe card for each question. You hire a menu expert who has memorised which dishes match which words and answers instantly, while the cashier goes back to taking orders.

**Trigger metrics**
- \`WHERE title ILIKE '%kurta%'\` is a **sequential scan**. On 500K variant rows it takes 300–1,800 ms and is among the top 3 queries by total time in pg_stat_statements.
- Business pain: zero-result rate above 10–15% because of typos ("kurtha"), Hinglish and synonyms ("chappal" vs "slippers"), and no relevance ranking.
- Facets (size, colour, price band, fabric) need COUNT queries over many columns.

**The ladder**
1. **Stay in Postgres first:** a \`pg_trgm\` GIN index makes ILIKE and similarity queries index-assisted, and \`tsvector\` adds stemming and ranking. Good up to about 1M rows and simple needs. No new infrastructure.
2. **Move to a search engine** (OpenSearch, Elasticsearch, Typesense, Meilisearch) when you need typo tolerance, synonyms, per-language analysers, facets at speed, and relevance tuning (boost in-stock, margin, popularity).
3. **Feed it from Postgres:** use **CDC** (Debezium → Kafka → indexer) or outbox events, not dual writes from the API. The index is a derived, rebuildable read model. Postgres stays the truth for price and stock at checkout.

**What it costs and what breaks**
- **Index staleness:** a product disabled in admin still appears for N seconds. Show it, then fail at add-to-cart gracefully.
- **Ops burden:** shard sizing, JVM heap, and zero-downtime reindex with aliases. A managed service helps.
- **Two sources** for "is it in stock": decide which wins in which context.

**Observability added.** Search p95, zero-result rate, click-through on the first result, indexing lag (DB commit to searchable), and cluster heap and GC.

→ Go deeper: search-systems §1 (why the DB is not a search engine), §8–§9 (CDC indexing pipeline, alias reindexing), prod-correctness-ops §12 (slow or stale search).`,
      code: [
        {
          language: 'sql',
          title: 'Rung 1 in Postgres: trigram index before any new cluster',
          code: `CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index turns '%kurta%' from a seq scan into an index scan
CREATE INDEX CONCURRENTLY idx_products_title_trgm
  ON products USING gin (lower(title) gin_trgm_ops);

-- Typo-tolerant lookup ranked by similarity; 'kurtha' still finds 'Cotton Kurta Set'
SELECT id, title, similarity(lower(title), 'kurtha') AS score
  FROM products
 WHERE lower(title) % 'kurtha'                 -- trigram similarity above pg_trgm.similarity_threshold (0.3)
   AND is_active
 ORDER BY score DESC
 LIMIT 20;

-- Substring search the old way, now index-assisted
EXPLAIN ANALYZE
SELECT id FROM products WHERE lower(title) LIKE '%kurta%' LIMIT 50;
-- Expect: Bitmap Index Scan on idx_products_title_trgm instead of Seq Scan.
-- Outgrow this when you need synonyms, Hinglish analysers, fast facets and relevance tuning.`,
        },
      ],
      diagram: `  admin --> [ Postgres ] --WAL--> [ Debezium ] --> [ Kafka ] --> [ indexer ]
               ^  truth for price/stock                            |
  checkout ----+                                                   v
  search box ---------------------------------------------> [ OpenSearch ]
                                   (derived, rebuildable, seconds stale)`,
      keyPoints: [
        'Trigger: ILIKE seq scans in the top queries, high zero-result rate, slow facets.',
        'pg_trgm/tsvector first; a search engine when relevance, typos, synonyms and facets matter.',
        'Feed the index by CDC or outbox, never dual writes; it is a rebuildable read model.',
        'Checkout still trusts Postgres, not the index.',
      ],
    },
    {
      heading: 'Stage 9 — Partition first, shard much later (1M users and beyond)',
      body: `**Pizza shop:** the storeroom has become so big that finding anything takes ages, and cleaning it shuts the shop. First, put shelves in it by month (partitioning): last month's shelf is easy to search and old shelves can be cleared in one go. Only when one storeroom physically cannot take more deliveries per hour do you open separate storerooms per neighbourhood (sharding), and then every recipe needing ingredients from two storerooms becomes harder.

**Partitioning: trigger metrics.** The large tables in a D2C app are rarely \`orders\`. At 3K orders/day, orders grow by only a few GB a year. The big ones are append-heavy logs: \`notification_log\` (about 2M rows/day once WhatsApp, SMS and email go out per order plus marketing), \`order_events\`, \`cart_activity\`, \`inventory_ledger\`. Signals:
- A table above about 100–500M rows, or above 200 GB.
- Retention DELETE jobs that run for hours and bloat the table.
- Autovacuum that never catches up.
- Index builds and restores that take too long.

**Partitioning: the change.** Native range partitioning by month on the time column. Queries that filter by time prune to one or two partitions. Retention becomes \`DROP\` or \`DETACH PARTITION\`, which is instant, and vacuum works per partition. It all stays on one server and is transparent to the app.

**Sharding: trigger metrics (usually 10M+ users or a marketplace).** The primary is already on the largest sensible instance and still above 70% CPU at sale peak, from **writes**. Write TPS is around 8–10K, WAL generation is so high that replicas lag, storage is in the multi-TB range so that **restore time exceeds the RTO**, and there are no cheaper levers left (caching, async, partitioning and query fixes are done).

**Sharding: the change**
- Choose a **shard key** that matches the dominant access pattern and spreads load. For a D2C storefront that is customer_id (orders, carts, addresses co-located). For a marketplace it is seller_id for seller-side tables.
- Use **Citus** (distributed Postgres) to keep SQL, or split by function (federation: payments in their own DB) first.
- Reference tables (categories, pincodes) are replicated to every node.

**What sharding costs.** Cross-shard queries ("all orders yesterday" for finance) need fan-out or a separate analytics store. There are no cross-shard foreign keys or cheap transactions. Resharding is a project, and a celebrity seller or bulk B2B buyer creates a hot shard. This is why the honest interview answer is "**I'd exhaust partitioning, caching, async and functional splits first**".

→ Go deeper: db-sharding §1–§2 (why sharding comes last, native partitioning), §4 (choosing the shard key), §7–§9 (resharding, federation, zero-downtime migration).`,
      code: [
        {
          language: 'sql',
          title: 'Partition the log table by month; retention becomes DROP, not DELETE',
          code: `CREATE TABLE notification_log (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  order_id    bigint,
  channel     text NOT NULL,            -- whatsapp | sms | email | push
  status      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)          -- the partition key must be part of the PK
) PARTITION BY RANGE (created_at);

CREATE TABLE notification_log_2026_10 PARTITION OF notification_log
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE notification_log_2026_11 PARTITION OF notification_log
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
-- (create future partitions ahead of time with pg_partman or a monthly job)

CREATE INDEX ON notification_log (order_id, created_at);  -- created on every partition

-- 90-day retention: instant, no bloat, no multi-hour DELETE
ALTER TABLE notification_log DETACH PARTITION notification_log_2026_07 CONCURRENTLY;
DROP TABLE notification_log_2026_07;

-- Much later, if writes outgrow one primary (Citus): co-locate a customer's data on one node
-- SELECT create_distributed_table('orders', 'customer_id');
-- SELECT create_distributed_table('order_items', 'customer_id', colocate_with => 'orders');
-- SELECT create_reference_table('pincodes');`,
        },
      ],
      diagram: `  Partitioning (one server)        Sharding (many servers)
  +--------------------------+     +-----------+ +---------+ +----------+
  | notification_log         |     | shard A   | | shard B | | shard C  |
  |  |- 2026_09 (detach/drop)|     | cust 0-33%| | 34-66%  | | 67-100%  |
  |  |- 2026_10              |     +-----------+ +---------+ +----------+
  |  |- 2026_11 (hot)        |        ^ router / Citus coordinator ^
  +--------------------------+     cross-shard query = fan-out + merge`,
      keyPoints: [
        'Partition append-heavy tables by time first: instant retention, per-partition vacuum, pruning.',
        'The big tables are logs and events, rarely orders, at 1M users.',
        'Shard only when writes, WAL or restore time exceed one primary after every cheaper lever.',
        'Shard key = dominant access pattern; cross-shard queries go to fan-out or an analytics store.',
      ],
    },
    {
      heading: 'Stage 10 — Multi-AZ: survive losing a data centre',
      body: `**Pizza shop:** your one kitchen is on a single power line. When the transformer blows, you close. Open a second kitchen across town on a different grid, with the same recipes and stock sync, so customers barely notice.

**Trigger metrics.** Revenue per hour of downtime is larger than the extra monthly cost. For DesiCart doing ₹3 crore a month, an hour of evening-peak downtime costs perhaps ₹10–15 lakh of sales plus customer trust. Also any enterprise or B2B SLA of 99.9% or more. An AZ-level incident in a region happens to most companies every year or two.

**The change, layer by layer**
- **App tier:** at least 3 replicas spread across 3 AZs (topology spread constraints), and the LB is multi-AZ by default.
- **Postgres:** RDS Multi-AZ, a synchronous standby in another AZ with automatic failover in about 60–120 s, or Aurora (6 copies across 3 AZs, failover to a reader in about 30 s).
- **Redis:** a replica in another AZ with automatic failover (ElastiCache Multi-AZ). The app tolerates a brief error spike during failover.
- **Queues:** SQS is multi-AZ inherently; for self-run brokers, replicate across AZs.
- **Static stability:** run enough capacity in the surviving AZs *before* an outage (N+1 by AZ), because the autoscaler may itself be impaired during the event.

**What it costs and what breaks**
- About 2× database cost (standby), plus cross-AZ data transfer (about $0.01/GB each way on AWS). Chatty services across AZs show up on the bill.
- Synchronous standby commits add about 1–2 ms of write latency.
- Failover drops connections: the app must reconnect and retry idempotent operations, and DNS TTL and connection-pool behaviour decide how long the blip lasts.

**Observability added.** Per-AZ error rate and latency, failover events, and "can we lose an AZ?" capacity dashboards. Run a **game day** at least once: fail an AZ in staging and time recovery.

→ Go deeper: rel-dr §5 (multi-AZ vs multi-region) and §11 (AZ-down runbooks, static stability), misc-ops §8.`,
      code: [
        {
          language: 'yaml',
          title: 'Kubernetes: spread API pods across AZs and keep capacity when one disappears',
          code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: desicart-api
spec:
  replicas: 6                     # 2 per AZ; losing one AZ leaves 4 = enough for normal peak
  selector:
    matchLabels: { app: desicart-api }
  template:
    metadata:
      labels: { app: desicart-api }
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule      # never pile all pods into one AZ
          labelSelector:
            matchLabels: { app: desicart-api }
      terminationGracePeriodSeconds: 30
      containers:
        - name: api
          image: registry.example/desicart-api:2026.10.12
          readinessProbe:
            httpGet: { path: /health/ready, port: 3000 }
            periodSeconds: 5
          resources:
            requests: { cpu: '1', memory: 1Gi }
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: desicart-api-pdb
spec:
  minAvailable: 4                 # node drains and upgrades cannot take us below safe capacity
  selector:
    matchLabels: { app: desicart-api }`,
        },
      ],
      diagram: `          [ multi-AZ load balancer ]
           /            |            \\
   [AZ-a pods]     [AZ-b pods]     [AZ-c pods]
        |               |               |
   [PG primary] ==sync==[PG standby]   [Redis replica]
   [Redis primary]                       auto-failover
   one AZ lost --> standby promoted (~1-2 min), pods in 2 AZs carry load`,
      keyPoints: [
        'Trigger: downtime cost per hour exceeds the monthly premium; SLAs of 99.9% and above.',
        'Every stateful layer needs a cross-AZ replica and tested failover.',
        'Static stability: pre-provision N+1 capacity by AZ.',
        'Costs: about 2× DB, cross-AZ transfer, small write-latency penalty.',
      ],
    },
    {
      heading: 'Stage 11 — Multi-region: only with a reason, active-passive first',
      body: `**Pizza shop:** a second kitchen in another city. It costs a lot, the two kitchens' stock books must be reconciled, and the menu must be identical. You do it only if a citywide shutdown would end the business, or if you have many customers in that city.

**Valid reasons (name one, or do not do it)**
1. **Disaster recovery beyond a region.** A business RTO or RPO that a regional outage would violate: "we must be back within 1 hour even if Mumbai is down".
2. **Latency for non-India users.** For example, a large NRI customer base in the Gulf and the US. But CDN plus edge caching usually solves most of this for a storefront. Only the dynamic APIs pay the RTT.
3. **Regulation and residency.** India's DPDP Act 2023 allows cross-border transfer except to restricted countries, but RBI rules require payment-system data to be stored only in India. Keeping primaries in-country and the DR region also in India (Mumbai plus Hyderabad on AWS) satisfies both.

**The ladder**
| Rung | Description | RTO / RPO | Cost |
|---|---|---|---|
| Backup and restore | Cross-region snapshot copies | Hours / hours | Low |
| Pilot light | DB replica in region 2, app infrastructure as code but scaled to zero | ~30–60 min / minutes | Medium |
| Warm standby | Small, running copy of the stack in region 2 | ~10–15 min / seconds–minutes | Medium–high |
| Active-active | Both regions serve writes | ~0 / ~0 for partitioned data | Highest; conflict handling |

**For DesiCart: warm standby in Hyderabad.** Use an Aurora Global Database (typical replication lag under 1 s) or a cross-region read replica, S3 cross-region replication for media, and container images in both registries. A DNS or global accelerator failover runbook is tested quarterly. Active-active is not justified: orders, stock and payments would need conflict resolution, or ownership pinned by region, for a market that is mostly one country.

**What it costs and what breaks.** Roughly 1.3–2× infrastructure, cross-region data transfer, and a doubled deploy surface. **Hidden single-region dependencies** are the classic failure: the secret manager, the auth provider, the container registry, the payment-gateway allow-list of IPs, or a cron that only exists in Mumbai.

**Observability added.** Cross-region replication lag, synthetic checks from multiple countries, and a **DR drill report** with measured RTO/RPO against targets.

→ Go deeper: rel-dr §4, §6–§7 (DR tiers, active-active conflicts, failover pitfalls), cdn-global §7–§8 (multi-region routing and data residency), prod-correctness-ops §7.`,
      diagram: `   users (India + NRI) --> [ CDN / global DNS, health-checked ]
                     |  normal                 |  failover (runbook, ~15 min)
                     v                         v
          [ ap-south-1 Mumbai: ACTIVE ]   [ ap-south-2 Hyderabad: WARM ]
           pods x 3 AZ, PG primary  ===async<1s===>  PG replica, pods min=2
           S3 media  ============== CRR ==============>  S3 replica
           hidden deps? secrets, auth, registry, PSP IP allow-list`,
      keyPoints: [
        'Need a named reason: DR beyond a region, non-local latency, or residency.',
        'Climb the DR ladder: backup → pilot light → warm standby → active-active.',
        'Warm standby in a second Indian region fits most Indian D2C companies.',
        'Hunt hidden single-region dependencies; drill failover and measure RTO/RPO.',
      ],
    },
    {
      heading: 'The observability and cost ledger across every stage',
      body: `**Intuition.** Each stage adds boxes, and each box needs a gauge on the dashboard and adds a line on the bill. Teams that skip the gauges find bottlenecks from customer complaints. Teams that skip the bill find out from the CFO.

| Stage | Must-have signals added | Approx. monthly infra (₹, order of magnitude) | Team that can run it |
|---|---|---|---|
| 0 One box | Uptime ping, Sentry, disk alert | ~10–15K | 1 dev |
| 1 Managed DB | DB CPU/conn, slow-query log, pg_stat_statements | ~25–35K | 1–2 |
| 2 Scale up | Event-loop lag, RED per route | ~50–70K | 2–3 |
| 3 Stateless + LB | Central logs + request id, LB 5xx, healthy hosts | ~0.8–1.5L | 3–5 |
| 4 Cache | Hit ratio per prefix, evictions, Redis p99 | +10–20K | — |
| 5 Replicas | Replica lag, routing ratio | +1× DB cost per replica | — |
| 6 CDN | CDN hit ratio, origin rps, real-user LCP by city | Egress-driven: ~1.3–2L at 13.5 TB | — |
| 7 Queues | Depth, oldest-job age, DLQ, end-to-end lag | +10–30K | 5–8 |
| 8 Search | Search p95, zero-result rate, indexing lag | +40K–1L (managed cluster) | — |
| 9 Partition/shard | Partition sizes, vacuum lag; per-shard load | Partition ~0; shard: many × DB | 8–15 incl. platform |
| 10 Multi-AZ | Per-AZ errors, failover events, AZ-loss capacity | ~+60–100% DB cost | — |
| 11 Multi-region | Cross-region lag, multi-country synthetics, drill RTO/RPO | ~1.3–2× total | dedicated SRE |

*Ranges are rough planning numbers for a 1M-user Indian D2C on AWS at list prices; reserved instances and savings plans typically cut compute 30–50%.*

**Three habits that scale with the app**
1. **Tracing from stage 3.** OpenTelemetry auto-instrumentation in NestJS (HTTP, pg, ioredis, BullMQ) shows that checkout spends 1.8 s on WhatsApp calls (stage 7's trigger) before a customer tells you.
2. **SLOs before growth.** Checkout availability 99.9% and checkout p99 under 800 ms give you objective triggers instead of opinions.
3. **Cost per order as a metric.** If infra cost per order rises from ₹4 to ₹9 across stages, something (often egress, logs or over-provisioned replicas) is scaling faster than the business. Log volume alone can become a top-3 line item. Sample debug logs and set retention per level.

**Interview close.** "At each stage I would show the trigger metric on a dashboard, make one change, and confirm the metric moved. That keeps the architecture as simple as the current load allows."

→ Go deeper: observability §4 (RED/USE/golden signals), §6 (tracing with OpenTelemetry in NestJS), §8–§9 (SLOs, burn-rate alerts), §11 (log cost).`,
      code: [
        {
          language: 'yaml',
          title: 'Prometheus alerts that encode the stage triggers',
          code: `groups:
  - name: scaling-triggers
    rules:
      - alert: AppCpuNoHeadroom          # stage 2/3: no room for a 10x sale
        expr: avg(rate(container_cpu_usage_seconds_total{app="desicart-api"}[5m])) by (app)
              / avg(kube_pod_container_resource_requests{app="desicart-api",resource="cpu"}) by (app) > 0.7
        for: 30m
      - alert: DbReadsDominate           # stage 4: cache candidates
        expr: sum(rate(pg_stat_database_tup_fetched{datname="desicart"}[5m]))
              / sum(rate(pg_stat_database_tup_inserted{datname="desicart"}[5m])
                + rate(pg_stat_database_tup_updated{datname="desicart"}[5m])) > 50
        for: 1h
      - alert: ReplicaLagOverRywWindow   # stage 5: read-your-writes window at risk
        expr: max(pg_replication_lag) > 4   # postgres_exporter, seconds
        for: 2m
      - alert: CheckoutP99OverSlo        # stage 7: side effects in the request path
        expr: histogram_quantile(0.99, sum(rate(http_server_duration_seconds_bucket{route="/checkout"}[5m])) by (le)) > 0.8
        for: 10m
      - alert: OldestJobTooOld           # stage 7: workers not keeping up
        expr: max(bullmq_oldest_waiting_job_age_seconds) > 300   # custom exporter gauge
        for: 5m`,
        },
      ],
      keyPoints: [
        'Every stage adds signals and cost; track both explicitly.',
        'Tracing from stage 3 surfaces the next trigger before customers do.',
        'SLOs turn scaling decisions from opinion into thresholds.',
        'Watch cost per order: egress, logs and idle replicas grow quietly.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'fund-scaling-journey-cc-1',
      title: 'The monolith that breaks the moment you add a second pod',
      context:
        'DesiCart is moving from one VM (stage 2) to three pods behind a load balancer (stage 3). In staging with 3 replicas, testers report being logged out at random, product images returning 404 about two-thirds of the time, and every customer receiving three "abandoned cart" reminder messages at 7 PM.',
      task: 'Find every piece of hidden per-instance state in this NestJS code and make the service safe to run as N identical, disposable replicas behind a load balancer.',
      starter: {
        language: 'typescript',
        code: `import { Controller, Post, Body, Req, UploadedFile, UseInterceptors, Injectable } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';

const sessions = new Map<string, { userId: string }>();   // lives in this process only

@Controller()
export class AppController {
  @Post('login')
  login(@Body() b: { userId: string }) {
    const sid = randomUUID();
    sessions.set(sid, { userId: b.userId });
    return { sid };                                         // next request may hit another pod
  }

  @Post('products/:id/image')
  @UseInterceptors(FileInterceptor('file', { storage: diskStorage({ destination: '/var/app/uploads' }) }))
  upload(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!sessions.get(req.headers['x-sid'])) throw new Error('unauthorised');
    return { url: '/uploads/' + file.filename };             // file exists on ONE pod's disk
  }
}

@Injectable()
export class CartReminderJob {
  constructor(private readonly carts: any, private readonly whatsapp: any) {}

  @Cron('0 19 * * *')                                      // fires on every replica
  async remind() {
    for (const c of await this.carts.findAbandoned()) await this.whatsapp.send(c.phone, 'Your cart misses you!');
  }
}`,
      },
      hints: [
        'List what a request on pod B needs that pod A created: there are three such things here.',
        'Sessions and the "who runs the cron" decision need a shared store; files need shared, durable storage that is not a pod at all.',
        'Even with a leader lock, make the reminder send idempotent per cart per day in case the lock holder dies mid-run.',
      ],
      solution: {
        language: 'typescript',
        code: `import { Controller, Post, Body, Param, Injectable, UseGuards } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { JwtAuthGuard } from './jwt-auth.guard'; // verifies the token on any pod: no shared session map

const s3 = new S3Client({ region: 'ap-south-1' });

@Controller()
export class AppController {
  constructor(private readonly jwt: JwtService) {}

  @Post('login')
  async login(@Body() b: { userId: string }) {
    // credential check omitted; short-lived access token + rotating refresh token (stored server-side)
    const accessToken = await this.jwt.signAsync({ sub: b.userId }, { expiresIn: '15m' });
    return { accessToken };
  }

  @Post('products/:id/image-upload-url')
  @UseGuards(JwtAuthGuard)
  async uploadUrl(@Param('id') productId: string) {
    const key = 'products/' + productId + '/' + randomUUID() + '.jpg'; // server-chosen key
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: process.env.MEDIA_BUCKET!, Key: key, ContentType: 'image/jpeg' }),
      { expiresIn: 300 },
    );
    // the browser PUTs straight to S3; the CDN serves it from https://cdn.example/<key>
    return { uploadUrl: url, publicUrl: process.env.CDN_BASE + '/' + key };
  }
}

@Injectable()
export class CartReminderJob {
  constructor(private readonly carts: any, private readonly whatsapp: any, private readonly redis: Redis) {}

  @Cron('0 19 * * *')
  async remind() {
    const day = new Date().toISOString().slice(0, 10);
    // leader election per run: only one replica gets the lock; it expires if that pod dies
    const gotLock = await this.redis.set('lock:cart-reminder:' + day, process.env.HOSTNAME ?? 'pod', 'EX', 3600, 'NX');
    if (gotLock !== 'OK') return;

    for (const c of await this.carts.findAbandoned()) {
      // idempotency per cart per day: a re-run after a crash skips carts already messaged
      const first = await this.redis.set('sent:cart-reminder:' + day + ':' + c.id, '1', 'EX', 172800, 'NX');
      if (first !== 'OK') continue;
      await this.whatsapp.send(c.phone, 'Your cart misses you!');
    }
  }
}`,
      },
      explanation: `- **Sessions:** the in-memory Map becomes a stateless JWT access token, verified on any pod. Refresh tokens or revocation lists live in a shared store. If server-side sessions are preferred, put them in Redis.
- **Uploads:** instead of multer writing to one pod's disk, the API issues a presigned S3 PUT with a server-chosen key. Bytes bypass the pods and the CDN serves reads (this also prepares stage 6).
- **Cron:** a per-run Redis lock (SET NX EX) means only one replica executes, and the TTL frees the lock if that pod dies.
- **Idempotent sends:** a per-cart-per-day marker prevents duplicate WhatsApp messages if the job is re-run after a crash or a lock expiry.
- **Result:** any pod can be killed, added or replaced at any time, which is the definition of a disposable, stateless app tier.`,
      followUps: [
        {
          q: 'The reminder job now takes 70 minutes for 2M abandoned carts, longer than the 60-minute lock TTL. What happens and how do you fix it?',
          a: 'At minute 60 the lock expires, but nothing new fires because the cron already ran today. A crash after minute 60, though, leaves no lock to block a manual re-run, and a lock with a TTL shorter than the job always invites overlapping runs. The bigger fix is the design: the cron should only **enqueue** work, pushing cart ids in batches of 1,000 to a queue, which takes seconds. Workers then send in parallel with rate limits per WhatsApp BSP, and each send stays idempotent. The lock then only needs to cover the few seconds of enqueueing.',
        },
        {
          q: 'Security asks how you log a user out everywhere immediately if access tokens are stateless JWTs.',
          a: 'Keep access tokens short-lived (5–15 minutes) and store refresh tokens server-side in Postgres or Redis, rotated on every use. "Log out everywhere" revokes all refresh tokens for that user, so access ends within one access-token lifetime. For immediate revocation, keep a small Redis denylist of `jti` values or a per-user `tokens_valid_after` timestamp that the guard checks. That costs one Redis read per request, which is cheap at this scale.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-cc-2',
      title: 'Read replicas went live and "my order disappeared"',
      context:
        'At stage 5, a teammate added a TypeORM-style read/write split: every GET goes to the replica, everything else to the primary. Primary CPU dropped from 78% to 41%. Then support tickets spiked: right after paying, users land on /orders/:id and see 404, and the payment-status poll sometimes shows PENDING for a paid order, which made some users pay twice.',
      task: 'Fix the routing so primary load stays low but no user sees their own writes disappear, payment status is never read stale, and the system degrades safely when replica lag spikes.',
      starter: {
        language: 'typescript',
        code: `import { Injectable, NestMiddleware } from '@nestjs/common';
import { Pool } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

export const als = new AsyncLocalStorage<{ db: Pool }>();
const primary = new Pool({ connectionString: process.env.DB_PRIMARY_URL });
const replica = new Pool({ connectionString: process.env.DB_REPLICA_URL });

@Injectable()
export class DbRoutingMiddleware implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    // every GET to the replica, no matter what it reads or when
    const db = req.method === 'GET' ? replica : primary;
    als.run({ db }, next);
  }
}

// OrdersController
export async function getOrder(id: string) {
  const { db } = als.getStore()!;
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
  if (!rows[0]) throw new Error('404');           // order committed 300 ms ago on the primary
  return rows[0];
}

export async function getPaymentStatus(orderId: string) {
  const { db } = als.getStore()!;
  const { rows } = await db.query('SELECT status FROM payments WHERE order_id = $1', [orderId]);
  return rows[0]?.status ?? 'PENDING';            // stale PENDING => user pays again
}`,
      },
      hints: [
        'Routing by HTTP verb ignores what is read and when. Which reads must always be fresh, and which only need to be fresh for the user who just wrote?',
        'You can record "this user wrote at LSN X" and compare it with what the replica has replayed.',
        'When the replica is too far behind, falling back to the primary must be bounded, or a lag spike becomes a primary overload.',
      ],
      solution: {
        language: 'typescript',
        code: `import { Injectable, NestMiddleware } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { AsyncLocalStorage } from 'node:async_hooks';

export const als = new AsyncLocalStorage<{ userId?: string }>();
const primary = new Pool({ connectionString: process.env.DB_PRIMARY_URL, max: 10 });
const replica = new Pool({ connectionString: process.env.DB_REPLICA_URL, max: 10 });
const redis = new Redis(process.env.REDIS_URL!);
let primaryFallbacksThisSecond = 0;
setInterval(() => (primaryFallbacksThisSecond = 0), 1000);
const MAX_FALLBACKS_PER_SEC = 200; // protects the primary when lag spikes for everyone

@Injectable()
export class RequestContext implements NestMiddleware {
  use(req: any, _res: any, next: () => void) {
    als.run({ userId: req.user?.id }, next);
  }
}

// Call after any committed write by a user (order placed, payment captured, address saved)
export async function recordWrite(userId: string) {
  const { rows } = await primary.query('SELECT pg_current_wal_lsn()::text AS lsn');
  await redis.set('lsn:' + userId, rows[0].lsn, 'EX', 30);
}

async function readPool(fresh: 'always' | 'own-writes' | 'stale-ok'): Promise<Pool> {
  if (fresh === 'always') return primary;
  const userId = als.getStore()?.userId;
  if (fresh === 'own-writes' && userId) {
    const lsn = await redis.get('lsn:' + userId);
    if (lsn) {
      // has the replica replayed past this user's last write?
      const { rows } = await replica.query('SELECT pg_last_wal_replay_lsn() >= $1::pg_lsn AS caught_up', [lsn]);
      if (!rows[0].caught_up) {
        if (primaryFallbacksThisSecond++ < MAX_FALLBACKS_PER_SEC) return primary;
        throw new Error('503 retry shortly'); // bounded: lag spike must not melt the primary
      }
    }
  }
  return replica;
}

export async function getOrder(id: string) {
  const db = await readPool('own-writes'); // the buyer sees their order at once; others may lag
  const { rows } = await db.query('SELECT id, status, total, created_at FROM orders WHERE id = $1', [id]);
  if (!rows[0]) throw new Error('404');
  return rows[0];
}

export async function getPaymentStatus(orderId: string) {
  const db = await readPool('always'); // money decisions never read a replica
  const { rows } = await db.query('SELECT status FROM payments WHERE order_id = $1', [orderId]);
  return rows[0]?.status ?? 'NOT_FOUND'; // never invent PENDING for a missing row
}`,
      },
      explanation: `- **Freshness is declared per read, not inferred from the HTTP verb.** \`always\` (payment status, checkout price and stock), \`own-writes\` (my order, my address), \`stale-ok\` (catalog, reviews).
- **LSN-based read-your-writes:** after a write, store the primary WAL LSN per user and serve that user from the replica only once \`pg_last_wal_replay_lsn()\` has passed it. This is exact and adapts to real lag, unlike a fixed time window.
- **Bounded fallback:** if many users are behind during a lag spike, at most 200 reads per second per pod fall back to the primary, and the rest get a retryable 503. A replica problem cannot turn into a primary outage.
- **Payment status always comes from the primary**, which removes the stale PENDING that caused double payments. A missing row returns NOT_FOUND instead of a misleading default.
- Explicit column lists and per-pool sizing keep connection budgets predictable.`,
      followUps: [
        {
          q: 'The LSN check adds a replica round trip to every own-writes read. Is that acceptable, and how would you avoid it?',
          a: 'It adds about 0.5 ms, and only for users who wrote in the last 30 s, a small fraction of reads. To avoid even that, cache the replica\'s replayed LSN per pod: one background query every 100 ms updates `replicaLsn`, and comparisons happen in memory. Postgres pg_lsn values compare as 64-bit positions, so convert the `X/Y` hex text to a BigInt for local comparison. Or skip the check by returning the newly created order in the POST response and rendering from it, which avoids the read entirely.',
        },
        {
          q: 'You add a second replica behind a DNS round-robin endpoint. What new bug can appear?',
          a: 'Monotonic-read violations: the LSN check may run against replica 1, which has caught up, while the query lands on replica 2, which has not, or consecutive page loads alternate between replicas at different positions, so data appears and disappears. Pin each check and its query to the same connection, which also means the same replica, by running both in one pooled client. For monotonic reads, route a user consistently to one replica (hash the user id to a replica) unless it is unhealthy.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'fund-scaling-journey-iq-1',
      difficulty: 'expert',
      context:
        'You join as the first senior backend hire at a D2C brand doing about ₹2 crore of sales a month. Everything runs on one large EC2 instance: NestJS, Postgres, Redis and uploaded images. The founder expects 10× growth by next Diwali.',
      question:
        'Present a 12-month scaling roadmap for this company. I want triggers and sequencing, not a list of technologies. What do you do in month 1, and what do you deliberately not do?',
      whatInterviewerLooksFor: [
        'Starts with risk reduction (backups, SPOF) before performance',
        'Sequences changes by measured triggers',
        'Sizes the 10× target with numbers',
        'Names explicit non-goals (microservices, sharding, multi-region)',
      ],
      modelAnswer: `### Size the target first
₹2 crore/month at about ₹1,500 AOV is about 13K orders/month, roughly 450/day. 10× is about 4.5K/day, with Diwali-day peaks around 15× normal. On the traffic side, if today's peak is about 60 QPS, the goal is about 600 QPS at normal peak and about 2–3K QPS at the Diwali spike. That is a modest compute load; the risks are the database, the spike and the single box.

### Month 1: stop the bleeding (risk, not speed)
- **Managed Postgres** with PITR, restore tested once (stage 1). Today one disk failure loses the business.
- **Images to S3 + CDN** with content-hashed URLs (stage 6). This removes the biggest disk and bandwidth consumer from the box.
- **Observability baseline:** Sentry, pg_stat_statements, a RED dashboard, uptime checks, and an SLO draft: checkout p99 800 ms, 99.9% availability.

### Months 2–4: make the app disposable
- Stateless NestJS (JWT/Redis sessions, no local files, leader-locked cron), 3 pods across AZs behind an ALB, zero-downtime deploys (stage 3).
- Fix the top 10 queries. Add Redis cache-aside for catalog and home (stage 4).

### Months 4–7: take side effects out of checkout
- Outbox + BullMQ for WhatsApp/SMS/email, invoices and courier booking (stage 7). The trigger is the trace showing checkout time spent on vendors.
- Multi-AZ for RDS and Redis once the cost of downtime at peak is clear (stage 10).

### Months 7–10: depend on the metrics
- A read replica only if pg_stat_statements shows uncacheable reads dominating (stage 5).
- pg_trgm search, and OpenSearch only if the zero-result rate and relevance justify it (stage 8).
- Partition notification and event logs (stage 9).

### Months 10–12: Diwali readiness
- A load test at 3× the projected peak, pre-warmed caches, a waiting room for deal drops, autoscaling minimums raised in advance, and a game day.

### What I deliberately do not do
Microservices, Kafka, sharding, Kubernetes if the team is under 5 engineers (ECS or plain ASGs are enough), and multi-region. None of them addresses a measured trigger at this size.`,
      followUps: [
        {
          q: 'The founder says, "Our competitor uses microservices; shouldn\'t we?" How do you respond?',
          a: 'Tie the answer to team and coupling, not traffic. With 4 engineers, microservices add network failure modes, distributed tracing needs, per-service deploy pipelines and data consistency problems, with no scaling benefit at 3K QPS. A modular monolith with clear module boundaries (catalog, orders, payments) gives most of the organisational benefit. Extract a service only when a module has a different scaling or release profile, such as search indexing or a separate seller portal team.',
        },
        {
          q: 'Which single dashboard would you show the founder every Monday?',
          a: 'One page: checkout success rate and p99 against SLO; orders per minute at the evening peak against capacity headroom from the last load test; error-budget burn; infra cost per order; and the top 3 risks with their mitigation dates. It links technical work to revenue and makes the next scaling step a visible, agreed decision instead of an engineering wish.',
        },
        {
          q: 'Halfway through, a sale doubles traffic unexpectedly, before stage 7 is done. What is your stopgap?',
          a: 'Wrap vendor calls (WhatsApp, SMS, invoices) in strict 1–2 s timeouts with a circuit breaker, and have checkout succeed even when they fail. Log the failure to a "notifications pending" table and replay it with a script afterwards. Raise the pod minimum and the DB instance size for the sale window. Pre-warm the catalog cache. It is ugly but it decouples revenue from vendor health for a weekend.',
        },
      ],
      pitfalls: [
        'Leading with Kubernetes, Kafka and microservices',
        'No numbers for the 10× target',
        'Performance work before backups and SPOF removal',
        'No explicit non-goals',
      ],
    },
    {
      id: 'fund-scaling-journey-iq-2',
      difficulty: 'medium',
      question:
        'A candidate on your team proposes that a brand-new store with 200 users should start on Kubernetes with five microservices, Kafka and a sharded database "so we never have to re-architect." What is your assessment?',
      whatInterviewerLooksFor: [
        'Recognises premature scaling as a cost, not insurance',
        'Quantifies operational burden against the actual load',
        'Proposes design choices that keep the future cheap without building it now',
        'Is respectful but direct',
      ],
      modelAnswer: `### The load does not justify it
200 users is perhaps 1 request per second. One VM or a small managed container service with managed Postgres handles 100–1,000× that. Each proposed component adds failure modes without solving a current bottleneck.

### What it actually costs
- **Kubernetes:** cluster upgrades, networking, ingress, secrets and RBAC. That is weeks of work up front and a recurring part-time job, or a managed control plane plus a node bill.
- **Five services:** network calls where function calls used to be, distributed tracing, versioned contracts, sagas for anything cross-service, and five pipelines.
- **Kafka:** brokers, partitions, consumer lag monitoring and schema evolution, all for maybe 10 events per second.
- **A sharded database:** no cross-shard joins or transactions, a shard key chosen before access patterns are known, and very likely the wrong one.

The biggest cost is **speed of learning**: an early product changes its data model weekly, and every one of these choices makes change slower.

### "Never re-architect" is a false promise
The shapes chosen today will be wrong in specifics (wrong boundaries, wrong shard key) because the access patterns do not exist yet. Re-architecting later from a clean monolith is cheaper than unwinding a wrong distributed design.

### What I would do instead: keep the future cheap
- A **modular monolith** with clean module boundaries and no cross-module table access.
- **Stateless from day one** (no local files or sessions), so stage 3 is a config change.
- **Outbox table** and **idempotency keys** early: cheap now, essential later.
- **IDs** that do not assume a single DB sequence (UUIDv7 or Snowflake-style), which removes one obstacle to future sharding.
- **Infrastructure as code** and basic observability.

Then let triggers such as CPU, p99, egress and deploy pain pull each stage in when it is needed.`,
      followUps: [
        {
          q: 'Which of those day-one choices would you insist on even for 200 users, and why?',
          a: 'Statelessness, managed Postgres with PITR, and idempotency keys on payment and order creation. The first makes horizontal scaling a non-event. The second protects against the only truly unrecoverable failure, data loss. The third prevents double charges, which hurt at any scale and are painful to retrofit once clients exist. All three cost hours, not weeks.',
        },
        {
          q: 'When would you change your mind and accept Kubernetes early?',
          a: 'When the organisation already runs a mature platform: an internal Kubernetes platform with templates, observability and an on-call team, where a new service gets a cluster namespace and CI pipeline in an hour. Then the marginal cost is low and consistency with the rest of the company wins. The objection is to building and operating that platform for one small app, not to the technology.',
        },
      ],
      pitfalls: [
        'Agreeing because it is "industry standard"',
        'Dismissing it without explaining costs',
        'Ignoring the cheap preparatory choices that make later stages easy',
      ],
    },
    {
      id: 'fund-scaling-journey-iq-3',
      difficulty: 'hard',
      context:
        'DesiCart\'s Postgres primary (16 vCPU) sits at 80% CPU at the 9 PM peak, and checkout p99 has crept from 400 ms to 1.4 s. You have budget for exactly one change this sprint: a bigger instance, a Redis cache, or a read replica.',
      question:
        'How do you decide which of the three to do first, and what data do you look at before deciding?',
      whatInterviewerLooksFor: [
        'Looks at pg_stat_statements and wait events before choosing',
        'Maps each option to the workload it fixes',
        'Considers lead time and risk of each option',
        'Defines how to verify the decision worked',
      ],
      modelAnswer: `### Look before choosing (about 30 minutes)
1. **pg_stat_statements, top 20 by total_exec_time.** What share is reads, and which queries are they? Are they the same catalog lookups repeated (cacheable), per-user history (replica candidates), or one terrible query?
2. **Wait events** (\`pg_stat_activity\`): CPU, IO:DataFileRead (working set larger than RAM), Lock (contention), or LWLock (WAL or buffer pressure).
3. **Cache hit ratio** of shared buffers and the IOPS trend.
4. **Write share:** TPS of inserts and updates and the WAL rate, since replicas do not fix writes.

### Map the findings to the options
| Finding | Best single change |
|---|---|
| A few queries without good indexes or with N+1 dominate | None of the three: fix them first, which is often the biggest win |
| 70%+ of time is repeated catalog or product reads | **Redis cache-aside**: removes most of that load; also cuts latency |
| Per-user reads such as order history or dashboards dominate, not cacheable | **Read replica** with read-your-writes routing |
| IO waits from a working set larger than RAM, or growth is mixed reads and writes | **Bigger instance** (more RAM): fastest, least code, buys time |
| Write-heavy (WAL, updates) | Bigger instance now; async and batching next; replicas would not help |

### Lead time and risk
A bigger instance is a 10–15 minute failover-based resize, with no code and no new failure modes. A cache needs code, invalidation and a stampede plan, about a week. A replica needs routing code and lag handling, also about a week. When the peak is tonight, **resize first** to buy weeks, then do the structural fix the data points to.

### Verify
Define success before the change, for example peak DB CPU under 55%, checkout p99 under 600 ms, and no new error types. Compare the same weekday peak before and after.`,
      followUps: [
        {
          q: 'pg_stat_statements shows one query is 35% of total time: the "recommended for you" query on the home page. What now?',
          a: 'That query is the problem, so look at its plan. It is probably a join with ORDER BY over a large table without a usable index. Options: precompute recommendations per user or segment offline into a table or Redis, refreshed hourly; cache the home rail per segment with a 10-minute TTL; or make the query cheaper with a proper index. Precomputation is usually right, because personalisation that changes hourly should never run per request at peak.',
        },
        {
          q: 'After adding the cache, DB CPU drops to 40%, but every day at exactly 9:00 PM it spikes to 95% for 2 minutes. Why?',
          a: 'Synchronised expiry. Keys filled at a cache restart or deploy expire together at the TTL, or a 9 PM campaign push sends everyone to the same uncached pages at once. Check the cache-miss rate by key prefix at 9:00. Fixes: jittered TTLs, request coalescing for hot keys, and pre-warming campaign landing pages and products a few minutes before the push goes out.',
        },
      ],
      pitfalls: [
        'Picking an option without looking at query data',
        'Choosing a replica for a write-heavy load',
        'Ignoring that query fixes often beat all three options',
        'No success criterion',
      ],
    },
    {
      id: 'fund-scaling-journey-iq-4',
      difficulty: 'hard',
      question:
        'You are about to put a NestJS monolith behind a load balancer with 6 replicas for the first time. Walk me through every assumption in a typical codebase that silently depends on there being exactly one instance, and how you would find them before production does.',
      whatInterviewerLooksFor: [
        'Covers sessions, files, cron, in-memory caches and rate limiters, websockets, local locks',
        'Mentions connection budget and graceful shutdown',
        'Has a systematic discovery method, not just a list',
        'Prioritises by user impact',
      ],
      modelAnswer: `### Hidden single-instance assumptions
1. **Sessions in memory** (express-session MemoryStore, a Map) cause random logouts. Fix: JWT, or a Redis session store.
2. **Files on local disk** (multer diskStorage, generated PDFs in /tmp served later) cause 404s from other pods. Fix: S3 with presigned URLs.
3. **Scheduled jobs** (@Cron, setInterval) run once per replica, causing duplicate emails and double settlement. Fix: a leader lock or an external scheduler, plus idempotency.
4. **In-memory rate limiters and caches** become N times the intended limit, and caches disagree between pods. Fix: Redis-backed limiters, and short TTLs or pub/sub invalidation for L1 caches.
5. **In-process locks or mutexes** (async-mutex around stock updates) protect nothing across pods. Fix: DB constraints or conditional updates.
6. **In-memory queues or event emitters** for side effects lose work when a pod dies. Fix: a durable queue or outbox.
7. **WebSocket or SSE state:** a user connected to pod A is not reachable from pod B. Fix: a Redis pub/sub adapter.
8. **Local counters and ID generators** (incrementing in memory) collide. Fix: DB sequences, UUIDv7, Snowflake-style IDs with a worker id.
9. **The connection budget:** 6 pods × 8 workers × a pool of 20 = 960 connections. Fix: smaller pools or PgBouncer.
10. **Shutdown behaviour:** no SIGTERM handling, so deploys drop in-flight requests. Fix: enableShutdownHooks, readiness turning false, then draining.

### How to find them systematically
- **Grep audit:** search for \`new Map(\`, \`setInterval\`, \`@Cron\`, \`diskStorage\`, \`fs.writeFile\`, \`MemoryStore\`, \`Mutex\`, \`EventEmitter\` and module-level \`let\` declarations.
- **Run 3 replicas locally** behind nginx round-robin (docker-compose scale) and run the E2E suite. Session and file bugs show up immediately.
- **Chaos in staging:** kill a pod during a checkout test and during a cron run.
- **Count side effects:** assert in tests that a single cron tick sends exactly one message per cart.

### Priority
Money and messaging duplicates (cron, locks) come first, then auth (sessions), then files. Caches and limiters last, because they degrade quietly rather than break.`,
      followUps: [
        {
          q: 'Your in-process L1 product cache has a 10-minute TTL. After a price change, pods disagree for up to 10 minutes. How do you fix that without dropping L1?',
          a: 'Shorten the L1 TTL to a few seconds, which keeps most of the hot-key benefit, and broadcast invalidations. On a product update, publish `invalidate:product:{id}` on Redis pub/sub, and every pod evicts the entry from its L1. Pub/sub is lossy, so the short TTL is the backstop that bounds staleness if a pod misses a message. Never serve checkout prices from L1.',
        },
        {
          q: 'How do you make @Cron jobs safe without adding Redis locks to each one?',
          a: 'Move scheduling out of the replicas. A Kubernetes CronJob, EventBridge Scheduler, or a single BullMQ repeatable job (BullMQ dedupes repeat jobs by key across workers) triggers the work exactly once per schedule, and the work runs as a queue job handled by any worker. The job is idempotent per (job, period), so a manual re-run or a scheduler retry is harmless. The replicas no longer know about time at all.',
        },
      ],
      pitfalls: [
        'Mentioning only sessions',
        'Using sticky sessions as the fix for everything',
        'Ignoring cron duplication and in-process locks',
        'No discovery method',
      ],
    },
    {
      id: 'fund-scaling-journey-iq-5',
      difficulty: 'expert',
      context:
        'Three years in, DesiCart has 12M users and a marketplace with 40K sellers. The Postgres primary is the largest instance in the family, at 70% CPU during sales, mostly from writes (orders, inventory, seller updates). WAL generation peaks at 120 MB/s and replicas lag up to 40 s. The database is 6 TB, and a full restore drill took 7 hours against a 2-hour RTO.',
      question:
        'Make the case for or against sharding now. If you shard, what is the shard key and what breaks? If not, what do you do instead?',
      whatInterviewerLooksFor: [
        'Checks that cheaper levers are exhausted (functional split, partitioning, async, archiving)',
        'Recognises the restore-time RTO breach as a strong independent trigger',
        'Chooses a shard key from access patterns, and handles both sides of a marketplace',
        'Plans the migration and the cross-shard needs',
      ],
      modelAnswer: `### First, are cheaper levers left?
- **Functional split (federation):** are seller catalog updates and inventory in the same DB as orders and payments? Moving the seller and catalog domain to its own Postgres could take 30–40% of writes and TBs off the primary with no sharding at all.
- **Archive and partition:** 6 TB likely includes years of order history and logs. Partition by month and move orders older than 18 months to cold storage or an analytics store. The hot set may drop to 2 TB.
- **Write hygiene:** inventory updated row by row per sync from sellers? Batch them, and skip no-op updates (\`WHERE stock IS DISTINCT FROM $1\`).

If these leave the primary at 40% CPU and restores at 2 TB (about 2–3 hours), I would **defer sharding** and do them first, in about one quarter.

### If triggers remain: shard
The **restore time breaching RTO** is a strong reason on its own. Smaller shards restore in parallel.
- **Buyer-side tables** (orders, carts, addresses, payments): shard by **customer_id**. "My orders" and checkout stay single-shard.
- **Seller-side views** (a seller's orders and payouts): do not shard by both keys. Maintain a **seller-order projection** keyed by seller_id, fed by CDC from the order shards, in a separately sharded store. Seller dashboards tolerate seconds of lag.
- **Inventory:** shard by seller_id or sku_id. Checkout reserves stock through an inventory service, so an order touching two sellers becomes a saga, which we already have at stage 7.
- **Tooling:** Citus to keep SQL and co-location (orders with order_items on customer_id), and reference tables for pincodes and categories. Use logical shards, 64–128 of them mapped to a few physical nodes, so rebalancing moves shards rather than rows.

### What breaks
Cross-shard reports move to the warehouse. Global uniqueness (coupon codes per user) needs keys that include the shard key or a separate service. The hot shards are bulk B2B buyers; isolate them.

### Migration
CDC into the new cluster, shadow reads to compare, cut over per domain, and keep a rollback path.`,
      followUps: [
        {
          q: 'Finance runs "total GMV per hour yesterday" directly on the primary today. What happens to that after sharding?',
          a: 'It becomes a fan-out across all shards, which is expensive and contends with OLTP. Move finance queries to a warehouse or OLAP store (BigQuery, Redshift, ClickHouse) fed by CDC with a few minutes of lag. Hourly GMV becomes a cheap aggregate there. For near-real-time GMV dashboards, run a streaming aggregation on the order-created events. The OLTP shards then serve only single-customer and single-order queries.',
        },
        {
          q: 'Why 64–128 logical shards on, say, 4 physical nodes, instead of 4 shards?',
          a: 'Resharding then becomes moving whole logical shards between nodes, which is just copying and remapping, instead of rehashing every row when you go from 4 to 8 nodes. With 128 logical shards you can grow to 128 nodes without changing the hash function. Hot logical shards can also be isolated on their own node. The cost is more objects to manage per node, which is small with Citus or Vitess automation.',
        },
      ],
      pitfalls: [
        'Sharding before functional split and archiving',
        'Choosing seller_id or customer_id without addressing the other side',
        'Ignoring restore time as a trigger',
        'No migration or rollback plan',
      ],
    },
    {
      id: 'fund-scaling-journey-iq-6',
      difficulty: 'hard',
      context:
        'The CFO asks: "We already pay for Multi-AZ. The vendor says multi-region active-active gives us 99.99%. It roughly doubles our ₹14 lakh/month infra bill. Should we do it?" 98% of DesiCart\'s customers are in India.',
      question: 'Answer the CFO. What would make it worth it, and what would you propose instead?',
      whatInterviewerLooksFor: [
        'Translates availability into downtime and revenue',
        'Separates AZ from region failure probabilities',
        'Mentions hidden dependencies that cap availability anyway',
        'Proposes a proportionate DR tier with tested RTO/RPO',
      ],
      modelAnswer: `### Translate the numbers
99.9% allows about 8.8 hours of downtime a year; 99.99% allows about 53 minutes. But our actual downtime last year was probably *not* regional outages. It was bad deploys, database incidents, and vendor or payment-gateway outages. Multi-region active-active fixes none of those, and it adds new failure modes: conflict resolution, replication bugs, and split brain during failover.

### What a regional outage costs us
Say a full-region outage of 4–6 hours happens perhaps once every few years. At about ₹4–5 lakh of sales per peak hour and ₹1–2 lakh off-peak, a 5-hour outage costs roughly ₹10–20 lakh plus trust. Active-active costs about ₹14 lakh *per month*, about ₹1.7 crore a year, plus engineering time. The expected loss avoided is far smaller than the cost.

### Payment gateways and couriers cap us anyway
Our checkout depends on Razorpay, SMS/WhatsApp vendors and courier APIs. If those are in the same failure domain, or simply have their own outages, our end-to-end availability cannot exceed theirs.

### What I propose instead
1. **Fix the actual causes of downtime first:** canary deploys with auto-rollback, a tested database failover, a second payment gateway behind a router, and circuit breakers on vendors.
2. **Warm standby in Hyderabad (ap-south-2):** an Aurora Global Database or cross-region replica, S3 replication, and infrastructure as code that scales region 2 up in minutes. Target **RTO 30 min, RPO under 1 min**, at roughly +25–35% infra cost, not +100%.
3. **Quarterly DR drill** with measured RTO and RPO reported to the CFO.

### When active-active would be worth it
A large share of revenue outside India where latency matters, contractual 99.99% SLAs with penalties, or a business where an hour down costs crores. None applies today.`,
      followUps: [
        {
          q: 'The CFO asks for one number to judge the DR investment each quarter. What is it?',
          a: 'Measured recovery time from the last drill against the target RTO, alongside measured data loss against the target RPO, for example "drill: 22 min RTO, 8 s RPO; targets 30 min and 1 min". A DR plan that has not been drilled is a guess. A drill that misses its targets means more investment, while a drill that comfortably beats them suggests we may be over-spending.',
        },
        {
          q: 'During a drill you discover the app in Hyderabad cannot start because secrets are fetched from Secrets Manager in Mumbai. What is the systemic fix?',
          a: 'Make region independence a checked property, not an accident. Replicate secrets to both regions (Secrets Manager supports multi-region replication), keep a container registry and KMS keys in each region, and add an automated "region 2 cold start" test to CI that brings up the stack with all Mumbai endpoints blocked by network policy. Then maintain an inventory of every external dependency with its region, including payment-gateway IP allow-lists for region 2.',
        },
      ],
      pitfalls: [
        'Saying yes because more nines sound better',
        'Ignoring that most downtime is self-inflicted',
        'Not converting availability into revenue',
        'Recommending DR without drills',
      ],
    },
    {
      id: 'fund-scaling-journey-iq-7',
      difficulty: 'medium',
      question:
        'What is the minimum observability you would have at stage 0 (one VM, 100 users), and how does it change by the time the app has 1M users across many pods? Be specific about which signals get added at which stage and why.',
      whatInterviewerLooksFor: [
        'Proportionate tooling per stage',
        'Signals tied to the next scaling trigger',
        'Correlation ids and tracing introduced when the system becomes distributed',
        'SLOs and alert hygiene',
      ],
      modelAnswer: `### Stage 0–1 (one box, then a managed DB)
- **Uptime check** from outside, every minute, plus **error tracking** (Sentry) with releases tagged.
- **Disk, CPU and memory alerts** at 80% on the box.
- **DB:** slow-query log above 500 ms and **pg_stat_statements**. This is the most useful tool for the next three stages, and it costs nothing.
That is about an afternoon of work. More would be noise for one engineer.

### Stage 2–3 (scale up, then many pods)
- **RED per route** (rate, errors, p50/p95/p99 duration) from a Prometheus client or APM.
- **Node-specific signals:** event-loop lag p99 and heap usage per worker.
- **Centralised structured logs** with a **request id** propagated from the LB, since debugging now spans machines.
- **LB:** healthy-host count, 5xx by target, and the autoscaling activity log.

### Stage 4–7 (cache, replicas, CDN, queues)
- Cache hit ratio per key prefix, evictions and Redis p99.
- Replica lag in seconds, alerting at the read-your-writes window.
- CDN hit ratio, origin requests/s, and real-user LCP by city tier.
- Queue depth, **age of the oldest job**, DLQ size, and end-to-end lag from order to notification.
- **Distributed tracing** (OpenTelemetry auto-instrumentation for HTTP, pg, ioredis, BullMQ) with tail sampling of slow and error traces.

### At 1M users
- **SLOs** for checkout availability and latency, with **burn-rate alerts** that page on symptoms rather than causes.
- **Cardinality and cost control:** no user ids in metric labels, sampled debug logs, retention per level.
- **Business metrics** next to technical ones: orders/min, payment success rate by gateway, and cost per order.
- **Dashboards for each scaling trigger**, so the next stage is a data-driven decision.

### The principle
Add a signal when the component it watches arrives, and make sure every signal points at either a page or the next scaling decision.`,
      followUps: [
        {
          q: 'Your monitoring bill grew 4× after adding OpenTelemetry. Where is the money going, and how do you cut it?',
          a: 'Usually span volume and high-cardinality attributes. Every Redis GET as a span, at 100% sampling, multiplies data by the number of DB and cache calls per request. Cut it with tail sampling: keep all errors and slow traces plus 1–5% of normal ones. Drop or aggregate noisy spans such as Redis GET, and strip user ids and full URLs from span attributes that feed metrics. Also set log retention per level: debug logs for 3 days, info for 15, and errors for 90.',
        },
        {
          q: 'Checkout p99 alert pages at 3 AM every night for 5 minutes, with no customer complaints. What do you do?',
          a: 'Find out what runs at 3 AM, typically a backup, vacuum, report or batch job contending with checkout, and fix the contention by moving that job to a replica or throttling it. Then fix the alerting. A latency alert on a route with very few requests at 3 AM is statistically noisy. Use an SLO burn-rate alert that needs a meaningful share of the error budget consumed, and set a minimum request count before paging.',
        },
      ],
      pitfalls: [
        'Full Datadog/APM stack for 100 users',
        'No correlation ids once there are multiple pods',
        'Alerting on causes (CPU) instead of symptoms at scale',
        'User ids as metric labels',
      ],
    },
    {
      id: 'fund-scaling-journey-iq-8',
      difficulty: 'expert',
      context:
        'At 1M users, DesiCart\'s AWS bill is ₹18 lakh/month. The CFO wants it cut by 40% within two quarters without hurting checkout p99 or availability.',
      question:
        'How do you find the 40%, and which levers from the scaling journey do you pull, in what order?',
      whatInterviewerLooksFor: [
        'Starts with a cost breakdown by service and by stage component',
        'Knows the big levers: commitments, right-sizing, egress and image bytes, logs, idle replicas',
        'Protects SLOs with measurement',
        'Gives a realistic sequence and an estimate per lever',
      ],
      modelAnswer: `### Break the bill down first
Use Cost Explorer grouped by service and tags. A typical 1M-user D2C bill looks like: compute (pods/EC2) 30%, RDS (primary, Multi-AZ standby, replicas) 25%, data transfer/CDN 20%, logs/monitoring 10%, OpenSearch 8%, other 7%. The real split decides the plan.

### Levers, in order of effort against return
1. **Commitments (weeks 1–2):** Savings Plans or reserved instances for steady compute and RDS. Typically 30–45% off that slice. On about 55% of the bill, that alone saves about 15–20% of the total. No architecture change.
2. **Right-sizing (weeks 2–6):** pods with CPU requests of 2 vCPU running at 15% utilisation, so cut requests and let HPA scale on real load. Move from x86 to Graviton for about 20% better price-performance. Check whether the reporting replica runs 24×7 when it is used 4 hours a day, and schedule or shrink it. Typical saving: 5–10% of the total.
3. **Bytes, not GBs (weeks 3–8):** image resizing to device width plus WebP/AVIF often cuts image bytes by 40–60%. With data transfer at about 20% of the bill, that is about 8–12% of the total. Also enable Brotli for JSON and cache API GETs at the CDN where safe.
4. **Logs (weeks 2–4):** sample debug logs, drop health-check logs, cut retention to 7 days for info and 30 for errors, and archive to S3. Logs often fall by 50%, about 5% of the total.
5. **Architecture review (quarter 2):** is OpenSearch over-provisioned for 50K SKUs, and would a managed Typesense or pg_trgm do? Are queues on Redis or SQS sized for Diwali all year? Use scheduled scaling for known sale windows instead of a permanent peak minimum.

### Guardrails
Track checkout p99, error rate and CDN hit ratio after every change. Do canary right-sizing per service, and keep Diwali headroom as scheduled capacity rather than permanent capacity.

### Estimate
Commitments 15–20%, right-sizing 5–10%, bytes 8–12%, logs about 5%. That adds up to 33–47%, so 40% is realistic in two quarters, mostly without touching the architecture.`,
      followUps: [
        {
          q: 'Engineering proposes removing Multi-AZ on RDS to save 20% of the DB line. Your view?',
          a: 'Reject it, or at least make the risk explicit. The standby is the cheapest protection against an AZ outage or a primary hardware failure. Without it, recovery means a snapshot restore or replica promotion with minutes to hours of downtime, plus possible data loss beyond the last replicated LSN. Instead, check whether the read replicas are still needed after caching. A dropped read replica often saves the same money without reducing durability.',
        },
        {
          q: 'How do you stop costs creeping back after the cut?',
          a: 'Make cost a tracked metric with owners. Tag every resource by team and service, publish a weekly cost per order and cost per 1K requests per service, and alert on budget anomalies, for example +20% week over week. Add cost review to the architecture review checklist ("what does this add per month at 1M users?"). Expire environments automatically, so preview stacks and load-test clusters do not live for months.',
        },
      ],
      pitfalls: [
        'Starting with an architecture rewrite instead of commitments and right-sizing',
        'Cutting redundancy (Multi-AZ) for savings',
        'No guardrail metrics while cutting',
        'Ignoring egress and image bytes',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'fund-scaling-journey-boe-1',
      question:
        'DesiCart reaches 1M registered users. Estimate average, evening-peak and sale-day QPS, then the number of NestJS pods and Postgres connections you need, including surviving the loss of one AZ during the sale.',
      assumptions: [
        '15% of registered users active daily: 150K DAU',
        '~80 API calls per DAU per day (several per page view)',
        'Evening peak 4× average; sale-day peak 15× average',
        'One pod (1 vCPU, one Node process) serves ~300 RPS of typical endpoints; target 70% utilisation',
        '3 AZs; pool of 10 connections per pod',
      ],
      steps: [
        { label: 'Daily calls', calc: '150,000 × 80 = 12M calls/day' },
        { label: 'Average QPS', calc: '12,000,000 ÷ 86,400 ≈ 140 QPS' },
        { label: 'Evening peak', calc: '140 × 4 ≈ 560 QPS' },
        { label: 'Sale peak', calc: '140 × 15 ≈ 2,100 QPS' },
        { label: 'Pods for sale peak', calc: '2,100 ÷ (300 × 0.7 = 210) ≈ 10 pods' },
        { label: 'Survive losing 1 of 3 AZs', calc: '10 ÷ (2/3) = 15 pods, i.e. 5 per AZ during the sale window' },
        { label: 'DB connections', calc: '15 pods × 10 = 150 connections; far below a typical max_connections of several hundred, no PgBouncer needed yet' },
      ],
      answer:
        'About 140 QPS on average, ~560 at the evening peak, ~2.1K on a sale day. Run ~10 pods for the sale peak, or 15 to survive an AZ loss, with ~150 DB connections. Normal days need only 3–6 pods.',
      insight:
        'At 1M users, compute is cheap and easy. The hard parts are the database (the queries behind those 2.1K QPS), the speed of the spike (autoscaling lag) and per-AZ headroom, so pre-scale on a schedule for sales.',
      followUps: [
        {
          q: 'Each pod process uses 20 connections (TypeORM default pool) and PM2 runs 4 processes per pod. Recompute.',
          a: 'That is 15 pods × 4 processes × 20 = 1,200 connections. That exceeds what a mid-size managed Postgres allows (often a few hundred to about 1–2K depending on RAM), and every idle connection costs memory, about 5–10 MB each. You would see "remaining connection slots are reserved" at the sale peak exactly when pods scale out. Fix it by sizing pools to need (about 5 per process), or put PgBouncer in transaction mode in front and keep server-side connections around 100–200.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-boe-2',
      question:
        'Which DesiCart table will force partitioning first: orders or notification_log? Estimate the yearly growth of both at 1M users.',
      assumptions: [
        '3K orders/day; one order with ~3 items plus indexes ≈ 5 KB on disk',
        'notification_log: ~2M rows/day (per-order WhatsApp/SMS/email updates plus marketing sends)',
        'notification_log row + index ≈ 600 bytes',
        'Retention policy for notifications: 90 days',
      ],
      steps: [
        { label: 'Orders per year', calc: '3,000 × 5 KB = 15 MB/day → × 365 ≈ 5.5 GB/year (~1.1M orders)' },
        { label: 'Notification rows per year', calc: '2M × 365 = 730M rows/year' },
        { label: 'Notification bytes per year', calc: '2M × 600 B = 1.2 GB/day → × 365 ≈ 438 GB/year' },
        { label: 'Retention DELETE size', calc: 'Each night deletes ~2M rows (~1.2 GB) → bloat, vacuum load and WAL that replicas must replay' },
        { label: 'With monthly partitions', calc: 'Retention = DROP one ~36 GB partition per month (30 × 1.2 GB), instant and bloat-free' },
      ],
      answer:
        'Orders grow ~5.5 GB/year, which is trivial. notification_log grows ~730M rows and ~438 GB a year, and its retention deletes create nightly bloat and replica lag. Partition notification_log by month now; orders can wait for years.',
      insight:
        'At this scale the scaling pain comes from append-only operational logs, not the business entities. Partition by time and turn retention into a partition drop before thinking about sharding.',
      followUps: [
        {
          q: 'Marketing wants to keep notification history for 2 years for attribution analysis. What changes?',
          a: 'Two years in Postgres is about 880 GB and 1.5B rows, kept only for analytics. Do not keep it in OLTP. Keep 90 days of hot partitions in Postgres for support lookups, and stream older months as Parquet to S3, for example by exporting each partition before it is detached. Query them with Athena or the warehouse. Storage costs drop by an order of magnitude and the OLTP database stays small, so restores stay fast.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-boe-3',
      question:
        'Estimate monthly image egress and CDN cost for DesiCart at 150K DAU, and what image optimisation saves. Also estimate the origin load with a 95% CDN hit ratio.',
      assumptions: [
        '150K DAU, ~60 product images viewed per user per day, ~50 KB average (unoptimised JPEG)',
        'CDN list price for India ≈ $0.17/GB (first 10 TB tier, approximate; check current), ₹84 per $',
        'S3 → CloudFront origin fetches are not billed as internet egress',
        'Resizing to device width + WebP/AVIF cuts bytes ~50%',
      ],
      steps: [
        { label: 'Daily image bytes', calc: '150,000 × 60 × 50 KB = 450 GB/day' },
        { label: 'Monthly', calc: '450 GB × 30 ≈ 13.5 TB/month' },
        { label: 'CDN egress cost', calc: '13,500 GB × $0.17 ≈ $2,300 ≈ ₹1.9 lakh/month' },
        { label: 'After optimisation', calc: '50% fewer bytes → 6.75 TB → ≈ $1,150 ≈ ₹97K/month (saves ~₹96K)' },
        { label: 'Origin load at 95% hit', calc: '5% × 13.5 TB ≈ 675 GB/month from S3 to the CDN' },
      ],
      answer:
        'About 13.5 TB/month of image egress, ≈ ₹1.9 lakh/month at CDN list price. Optimising formats and sizes roughly halves that to ≈ ₹1 lakh. The origin serves only ~675 GB/month.',
      insight:
        'The CDN buys latency and origin offload. The cost lever is bytes per image: resizing, modern formats and lazy loading save more than switching CDNs.',
      followUps: [
        {
          q: 'A misconfigured cache key includes a tracking query string (?utm_source=...), and the hit ratio drops to 60%. What changes?',
          a: 'Origin fetches rise from 5% to 40%, so 8× more requests go to S3. That means more S3 GET charges and slower first loads for users who miss the cache, and if images are resized at the origin on demand, 8× more transform compute too, which can saturate the resizer during a sale. The CDN egress bill hardly changes, because bytes to users are the same. Fix: exclude query strings from the cache key, except for an explicit version or width parameter.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'fund-scaling-journey-mcq-01',
      difficulty: 'medium',
      question:
        'DesiCart runs NestJS, Postgres and uploads on one VM, has 400 users and has just started taking real payments. Which single change gives the most value first?',
      options: [
        'Move Postgres to a managed service with automated backups and point-in-time recovery, and test a restore',
        'Introduce Kafka so order events can be replayed later',
        'Move to Kubernetes so the app can autoscale',
        'Shard the orders table by customer_id to prepare for growth',
      ],
      correct: [0],
      explanation:
        'At 400 users nothing is overloaded, but a disk failure would lose orders and the backups with them. Durability and recoverability are the first real risk once money flows. Kafka, Kubernetes and sharding answer scaling problems the store does not have, and each adds operational burden that slows a tiny team.',
      followUps: [
        {
          q: 'The founder asks what RPO and RTO the managed DB gives you. What do you say?',
          a: 'With automated backups plus WAL archiving, point-in-time recovery gives an RPO of about 5 minutes on RDS. Transaction logs are uploaded roughly every 5 minutes. RTO is the restore time: tens of minutes for a small database, growing with size, so measure it in a drill. For a much faster RTO on instance failure, Multi-AZ adds a standby that fails over in about 1–2 minutes.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-02',
      difficulty: 'hard',
      question:
        'You are moving a NestJS monolith from one instance to six behind a load balancer. Which of these will break or misbehave? Select ALL that apply.',
      options: [
        'Sessions stored with express-session\'s default MemoryStore',
        'A @Cron job that emails daily order summaries to sellers',
        'Configuration read from environment variables injected by the deployment',
        'JWT access tokens verified with a public key that every pod loads from the secret manager',
        'Product images saved with multer diskStorage and served from /uploads',
      ],
      correct: [0, 1, 4],
      explanation:
        'MemoryStore sessions exist only in the pod that created them, so users get logged out at random. A @Cron runs on all six pods, which sends six emails. Files on one pod\'s disk return 404 from the other five. Environment configuration is identical per pod by design, and JWT verification with a shared public key is stateless, so both are already horizontal-friendly.',
      followUps: [
        {
          q: 'Could sticky sessions at the LB fix the first and third problems temporarily?',
          a: 'Stickiness hides the session problem until a pod dies or a deploy reshuffles connections, and then those users are logged out. It also unbalances load. It does nothing for files, because an image URL fetched by another user, or by the CDN, can still land on a different pod. Use it at most as a bridge for days while sessions move to Redis or JWT and uploads move to S3.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-03',
      difficulty: 'expert',
      question:
        'Before a sale, the team scales the API from 4 to 10 pods (8 vCPU each) with this config. Managed Postgres has max_connections = 800. What happens as pods come up?',
      code: {
        language: 'javascript',
        code: `// ecosystem.config.js inside each pod
module.exports = {
  apps: [{
    name: 'api',
    script: 'dist/main.js',
    exec_mode: 'cluster',
    instances: 'max',            // 8 workers per pod
    env: { PG_POOL_MAX: '20' },  // per worker, eagerly warmed at boot
  }],
};`,
      },
      options: [
        'Fine: PM2 workers share a single pg pool per pod, so 10 pods use 200 connections',
        'Around the 5th pod, new connections fail with "too many clients", so the newest pods never become ready and some requests fail on the old ones',
        'Postgres queues extra connections until earlier ones close, so latency rises but nothing fails',
        'PM2 automatically reduces instances when the database rejects connections',
      ],
      correct: [1],
      explanation:
        'Each PM2 worker is a separate process with its own pool: 8 × 20 = 160 connections per pod, so 800 is reached at 5 pods. Further connection attempts are rejected (not queued) with "sorry, too many clients already", and pods that cannot connect fail readiness. Workers do not share pools, and PM2 has no feedback from the database.',
      followUps: [
        {
          q: 'What two changes fix this for good?',
          a: 'First, size pools to actual concurrency: with Little\'s law, about 300 RPS per pod × 5 ms average query time is about 1.5 busy connections, so 3–5 per worker is plenty. Second, put PgBouncer in transaction mode (or RDS Proxy) between the pods and Postgres, so thousands of client connections map to about 100–200 server connections. Then alert on connections used as a percentage of max at 70%.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-04',
      difficulty: 'hard',
      question:
        'At 300K users, Postgres is at 75% CPU at peak. pg_stat_statements shows 82% of total execution time in `SELECT … FROM products WHERE id = $1` (40M calls/day, 0.8 ms each). Products change a few times a day. What is the best next step?',
      options: [
        'Add two read replicas and route product reads to them',
        'Add Redis cache-aside for product documents with invalidation on update and a jittered TTL',
        'Create another index on products(id) to speed the lookup',
        'Upgrade to an instance with twice the vCPUs',
      ],
      correct: [1],
      explanation:
        'The load is the same rarely-changing rows read repeatedly, the textbook cache case. A 95%+ hit ratio removes most of that 82% of DB time. Replicas only copy the load across more paid instances and add lag. The primary-key index already exists, and 0.8 ms per call is the query being fast many times over. A bigger instance buys time, but at twice the cost, without removing the redundant work.',
      followUps: [
        {
          q: 'After caching, DB CPU falls to 30%. Which query category becomes the new top consumer, typically, and what is its rung?',
          a: 'Usually the per-user and analytical reads that cache poorly: order history, seller and admin dashboards, finance exports. Those are read-replica candidates, routed with a read-your-writes guard for the user who just wrote. Heavy reports go to a dedicated reporting replica with longer timeouts, so they cannot hurt checkout.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-05',
      difficulty: 'expert',
      question:
        'This invalidation runs when an admin changes a product price. Occasionally the listing shows the old price for the full 30-minute TTL. Why?',
      code: {
        language: 'typescript',
        code: `async updatePrice(id: string, price: number) {
  await this.pool.query('UPDATE products SET price = $2 WHERE id = $1', [id, price]);
  await this.redis.del('product:' + id);
}

async getProduct(id: string) {
  const hit = await this.redis.get('product:' + id);
  if (hit) return JSON.parse(hit);
  const { rows } = await this.pool.query('SELECT * FROM products WHERE id = $1', [id]);
  await this.redis.set('product:' + id, JSON.stringify(rows[0]), 'EX', 1800);
  return rows[0];
}`,
      },
      options: [
        'redis.del is asynchronous on the server, so the key is deleted a few seconds later',
        'A reader that missed the cache read the old row before the UPDATE committed, then wrote it to Redis after the DEL, re-caching the stale price for 30 minutes',
        'Postgres returns the old price for a few seconds after UPDATE because of MVCC',
        'JSON.stringify drops numeric fields that changed type',
      ],
      correct: [1],
      explanation:
        'This is the classic cache-aside race: reader misses → reads old row → writer updates and deletes → reader SETs the old value. The delete happened before the stale fill, so it protected nothing. DEL is applied immediately in Redis. Once the UPDATE commits, new statements on the same primary see the new row, because MVCC hides only uncommitted data. Serialisation is unrelated.',
      followUps: [
        {
          q: 'Give two fixes and their trade-offs.',
          a: '(1) **Version-bumped keys:** INCR `pver:{id}` after commit and read `product:{id}:v{n}`. A stale fill lands under the old version key, which nobody reads any more. Cost: one extra GET per read, which can be pipelined. (2) **Delayed double delete or short TTL:** delete again about 1 s after commit to catch late fills. It is simpler but probabilistic. For checkout, avoid the question entirely by reading price from the primary.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-06',
      difficulty: 'hard',
      question:
        'The team adds two read replicas and routes all GETs to them. Primary CPU only drops from 80% to 76%. What is the most likely explanation?',
      options: [
        'The replicas are too small and should match the primary\'s size',
        'The primary\'s CPU is dominated by writes (and their index maintenance), which every replica must also replay; moving reads barely relieves it',
        'Replication itself consumes most of the primary\'s CPU',
        'The LB is sending GETs to the primary because of sticky sessions',
      ],
      correct: [1],
      explanation:
        'If read traffic was a small share of primary CPU, moving it changes little. Writes, triggers and index updates stay on the primary, and every replica replays them too. Replica size affects the replicas, not the primary. WAL sending is cheap compared with query execution. Routing happens in the app\'s DB layer, not the HTTP LB.',
      followUps: [
        {
          q: 'What would you look at to confirm that writes dominate, and what are the next rungs?',
          a: 'Check pg_stat_statements sorted by total time, filtered to INSERT and UPDATE, and the WAL generation rate. Look for hot rows such as inventory counters or a sessions table. Next rungs: batch and coalesce writes (skip no-op updates), move side-effect tables like logs and audits to partitioned or async storage, take high-churn data such as carts and sessions to Redis, then use a bigger primary, a functional split, and only at the end sharding.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-07',
      difficulty: 'medium',
      question:
        'A product manager says, "Putting a CDN in front of our images will cut our AWS bill in half." For an India-only store on AWS, which statement is most accurate?',
      options: [
        'Correct: CDN bandwidth is always far cheaper than origin bandwidth',
        'The CDN mainly improves latency and offloads the origin; per-GB list prices are not necessarily lower, so the bigger saving comes from serving fewer bytes (resizing, WebP/AVIF)',
        'CDNs only help users outside India, so it will not change anything',
        'The CDN will increase costs because every request still goes to S3',
      ],
      correct: [1],
      explanation:
        'In India, CDN per-GB list pricing can be similar to or higher than EC2 internet egress. The CDN wins on latency (edges near users), origin offload, and absorbing sale spikes. Cost falls mainly through fewer bytes and negotiated or committed pricing. CDNs help domestic users across cities. With a good hit ratio, most requests never reach S3.',
      followUps: [
        {
          q: 'How would you measure that the CDN actually improved user experience?',
          a: 'Use real-user monitoring: compare LCP and image load times by city tier (metro, tier-2, tier-3) and network type before and after, at p75, which is what Core Web Vitals use. Watch CDN hit ratio and origin response times alongside them. Synthetic checks from a few Indian locations help with debugging, but RUM shows what customers on Jio and Airtel 4G actually experienced.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-08',
      difficulty: 'expert',
      question:
        'Checkout used to call the WhatsApp BSP, the invoice generator and the courier API synchronously. You move them to queue workers fed by a transactional outbox. Which new problems must you now handle? Select ALL that apply.',
      options: [
        'Duplicate WhatsApp confirmations, because delivery from the queue is at-least-once',
        'A "shipped" message arriving before "order confirmed" when jobs for the same order run in parallel',
        'Checkout p99 rising, because the outbox insert doubles the transaction time',
        'Dead-lettered jobs piling up unnoticed unless someone owns and alerts on the DLQ',
        'Orders lost if Redis restarts after the order commits but before the job is enqueued',
      ],
      correct: [0, 1, 3],
      explanation:
        'At-least-once delivery means handlers need idempotency, such as a sent-marker per order and template. Parallel workers can reorder per-order events, so key by order or check state before sending. DLQs need owners and alerts. An outbox insert adds about a millisecond, not double the time. The outbox exists precisely so that a broker outage between commit and enqueue loses nothing: the relay publishes the row later.',
      followUps: [
        {
          q: 'How do you guarantee per-order ordering without serialising all notifications?',
          a: 'Partition by order id. Use BullMQ groups, or FIFO SQS with MessageGroupId = order id, or Kafka keyed by order id, so events for one order are processed in sequence while different orders run in parallel. Alternatively, accept out-of-order delivery and make handlers state-aware: before sending "shipped", check the order\'s current state and the last notification sent, and skip or delay if "confirmed" has not gone out yet.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-09',
      difficulty: 'hard',
      question:
        'Search is slow on 500K product variants despite this index. What explains the plan, and what is the cheapest effective fix?',
      code: {
        language: 'sql',
        code: `CREATE INDEX idx_products_title ON products (title);

EXPLAIN ANALYZE
SELECT id, title FROM products
 WHERE title ILIKE '%' || 'kurta' || '%'
 LIMIT 50;
-- Seq Scan on products  (actual time=0.02..1460.3 rows=50 loops=1)
--   Filter: (title ~~* '%kurta%'::text)`,
      },
      options: [
        'The planner statistics are stale; run ANALYZE and the B-tree will be used',
        'A B-tree cannot serve a leading-wildcard, case-insensitive pattern; add a pg_trgm GIN index (e.g. on lower(title)) so the pattern match is index-assisted',
        'LIMIT 50 forces a sequential scan; remove it',
        'Move search to OpenSearch immediately, since Postgres cannot index text',
      ],
      correct: [1],
      explanation:
        'B-tree indexes support prefix patterns at most (with the right collation or operator class), never "%term%" anywhere in the string, and ILIKE adds case folding. A trigram GIN index makes contains and similarity searches index-assisted, which is often enough at this size. ANALYZE does not change what a B-tree can do. LIMIT is not the cause. OpenSearch is the next rung when you need synonyms, typo tolerance and facets, not the first.',
      followUps: [
        {
          q: 'Users type "kurtha" and "kurti set" and expect results. Does pg_trgm still suffice?',
          a: 'Partly. Trigram similarity (`%` operator, `similarity()`) tolerates small typos like "kurtha", but "kurti" versus "kurta" and Hinglish synonyms ("chappal" for slippers) need synonym dictionaries, stemming and per-field boosting. A high zero-result rate on such queries is the trigger to move to OpenSearch, with synonyms, an edge-ngram autocomplete field and CDC-fed indexing.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-10',
      difficulty: 'expert',
      question:
        'notification_log has 900M rows. A nightly `DELETE … WHERE created_at < now() - interval \'90 days\'` runs for 5 hours, replicas lag up to 20 minutes, and the table keeps growing on disk. What is the best structural fix?',
      options: [
        'Run the DELETE in batches of 10K with a sleep in between',
        'Convert to monthly range partitions on created_at and enforce retention by detaching and dropping whole partitions',
        'Shard notification_log by customer_id across four databases',
        'Add an index on created_at so the DELETE finds rows faster',
      ],
      correct: [1],
      explanation:
        'Retention on an append-only time-series table is what partitioning is for. Dropping a partition is a metadata operation: no row-by-row deletes, no bloat, no WAL flood for replicas. Batching reduces lag but still rewrites and bloats the table every night. Sharding spreads the same problem across four databases. An index helps find rows, but deleting them still costs the same writes, vacuum and WAL.',
      followUps: [
        {
          q: 'How do you migrate the existing 900M-row table to partitions without downtime?',
          a: 'Create a new partitioned table with future partitions. Switch writes to it, either by renaming plus a view, or by writing to both for a short window. Then backfill only the last 90 days from the old table in batches into the matching partitions, since older rows are past retention anyway. Point reads at the new table, verify counts, and drop the old table, which also reclaims all its bloat at once. With pg_partman, monthly partition creation is automated afterwards.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-11',
      difficulty: 'hard',
      question:
        'Years later, DesiCart\'s buyer-side tables (orders, order_items, carts, addresses, payments) must be sharded. Which shard key best fits the dominant access patterns?',
      options: [
        'order_id, because it distributes writes perfectly evenly',
        'customer_id, so a customer\'s orders, cart, addresses and payments are co-located and checkout and "My Orders" stay single-shard',
        'created_at month, so recent data is together and old shards can be archived',
        'delivery pincode, to keep regional data close to warehouses',
      ],
      correct: [1],
      explanation:
        'Most buyer-side queries are "for this customer", so co-locating by customer_id keeps them single-shard and lets order_items join locally with orders. order_id spreads writes evenly but scatters a customer\'s history across every shard. A time key sends all current writes to one hot shard. Pincode skews heavily (metros) and does not match the queries.',
      followUps: [
        {
          q: 'A B2B buyer places 40K orders a month and makes one shard hot. What do you do?',
          a: 'Isolate the outlier. With logical shards (for example 128 mapped to physical nodes), move that customer\'s logical shard to a dedicated node, or use Citus tenant isolation to give the customer its own shard. Rate-limit or batch their bulk APIs, and read their large order lists from a replica or a projection. Keep the shard key; handle the skew explicitly.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-12',
      difficulty: 'expert',
      question:
        'Which of these make an availability-zone failure survivable for DesiCart\'s production stack? Select ALL that apply.',
      options: [
        'Topology spread constraints so API pods run in all three AZs',
        'Enough pre-provisioned capacity that two AZs alone can carry peak load',
        'RDS Multi-AZ with a synchronous standby and automatic failover',
        'A single NAT gateway in AZ-a that all private subnets route through',
        'Relying on the autoscaler to launch replacement capacity after the AZ fails',
      ],
      correct: [0, 1, 2],
      explanation:
        'Spreading pods, keeping static N+1 capacity per AZ and running a synchronous DB standby remove the AZ as a single point of failure. One NAT gateway in AZ-a is a hidden SPOF: if that AZ goes, every private subnet loses outbound internet, including payment-gateway calls. The autoscaler is not a plan, because during AZ incidents the control plane and capacity may be impaired, which is why static stability matters.',
      followUps: [
        {
          q: 'During a database failover the app sees errors for about 90 seconds. How do you shrink the customer-visible impact?',
          a: 'On the client side: short connect timeouts, a pool that discards broken connections and reconnects, and retries with jitter on idempotent requests only, such as reads and requests carrying idempotency keys. Use the cluster endpoint, whose DNS TTL is low, and avoid caching the resolved IP in long-lived processes. RDS Proxy or Aurora can cut failover to about 30 s or less. On the product side, serve catalog pages from cache during the window, and show checkout a retryable "try again in a moment" message instead of a 500.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-13',
      difficulty: 'hard',
      question:
        'DesiCart is India-only, already Multi-AZ in Mumbai. Which is a valid reason to invest in a second region?',
      options: [
        'Delhi users see 25 ms more latency than Mumbai users for API calls',
        'The business requires recovery within 1 hour even if the entire Mumbai region is unavailable, and restore-from-backup elsewhere has been measured at 6 hours',
        'A vendor says multi-region gives 99.99% instead of 99.9%',
        'Read traffic is growing and a second region would add read capacity',
      ],
      correct: [1],
      explanation:
        'A stated RTO that a single region cannot meet, backed by a measured restore time, is a concrete DR trigger, and a warm standby in a second Indian region addresses it. 25 ms intra-India latency is small and largely solved by the CDN for static content. Vendor nines ignore that most downtime is self-inflicted. Read capacity is cheaper with caches and replicas in the same region.',
      followUps: [
        {
          q: 'Which DR tier would you pick to meet that 1-hour RTO, and how do you prove it?',
          a: 'Pilot light or warm standby in Hyderabad: a cross-region database replica (or Aurora Global Database), replicated S3 and secrets, and infrastructure as code that scales region 2 from minimum to full size in about 15–30 minutes. Prove it with a quarterly drill: block Mumbai, promote the replica, shift DNS, place a real test order, and record the measured RTO and RPO against the targets.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-14',
      difficulty: 'expert',
      question:
        'During a planned RDS failover (~90 s), the whole storefront, including cached catalog pages, went down. Given this probe config, why?',
      code: {
        language: 'yaml',
        code: `readinessProbe:
  httpGet: { path: /health, port: 3000 }   # /health runs SELECT 1 on Postgres and PING on Redis
  periodSeconds: 5
  failureThreshold: 2
livenessProbe:
  httpGet: { path: /health, port: 3000 }
  periodSeconds: 10
  failureThreshold: 3`,
      },
      options: [
        'The probe interval is too long, so Kubernetes did not notice the DB was back',
        'Both probes hard-depend on a shared dependency: when Postgres failed over, every pod became unready (no LB targets at all) and then liveness restarted them, so even cache-served pages had no pod to answer',
        'Readiness probes cannot use HTTP; they must use TCP checks',
        'failureThreshold: 2 is too low and should be 1',
      ],
      correct: [1],
      explanation:
        'When every pod\'s readiness depends on the same database, a DB blip removes all endpoints at once, so pages that could be served from Redis or memory are not served either. Liveness on the same check restarts healthy processes, lengthening the outage with cold starts. Readiness should reflect the pod\'s own ability to serve, and liveness should check only that the process is not wedged. Probe interval, HTTP probes and the threshold are not the cause.',
      followUps: [
        {
          q: 'So how should the endpoint behave during a DB outage instead?',
          a: 'Keep the pod ready, since it can still serve cached and static responses, and degrade per route. Catalog serves from cache, while checkout returns a fast 503 with Retry-After through a circuit breaker on the DB. Liveness checks only that the event loop responds. Optionally, mark readiness false for a single pod whose own local connection pool is broken while other pods are fine. A shared-dependency outage should never be expressed as every pod being unready.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-15',
      difficulty: 'medium',
      question:
        'A Diwali deal drops at 8:00 PM and traffic jumps 15× within 3 minutes; your CPU-based HPA takes 4–5 minutes to add pods and new pods need 60 s to warm. Which preparations help? Select ALL that apply.',
      options: [
        'Scheduled scale-up of minimum replicas (and DB capacity) at 7:40 PM',
        'Pre-warming Redis with the deal products and category pages before 8:00',
        'Relying on the default CPU HPA, since it reacts within seconds',
        'A virtual waiting room or token gate for the deal page to admit users at a sustainable rate',
      ],
      correct: [0, 1, 3],
      explanation:
        'Known spikes call for scheduled capacity, because reactive autoscaling plus warm-up loses the first minutes, exactly when traffic peaks. Pre-warming avoids a cold-cache stampede on the database. A waiting room converts an unbounded spike into a controlled admission rate. The default HPA does not react within seconds: metrics windows, scale-up policies, node provisioning and app warm-up add minutes.',
      followUps: [
        {
          q: 'The pods are ready at 7:40 but p99 still spikes at 8:00:05. Where do you look first?',
          a: 'At the shared tiers that did not scale with the pods. Check DB connections and CPU (did the extra pods exhaust connections?), Redis hot keys (the deal SKU on one shard), cold JIT and connection pools in the new pods (send warm-up traffic before 8:00), and any synchronous vendor call on the deal path. Traces at 8:00:05 show which span grew.',
        },
      ],
    },
    {
      id: 'fund-scaling-journey-mcq-16',
      difficulty: 'hard',
      question:
        'At 300K users DesiCart has three problems: DB CPU high from catalog reads, checkout p99 at 2.4 s because of WhatsApp and invoice calls, and product images served from app disk (which blocks running more than one pod). Which sequence is most defensible?',
      options: [
        'Shard the database first, then add a cache, then queues, then move images',
        'Move images to S3 + CDN and make the app stateless, then add Redis caching for the catalog, then move side effects to queues with an outbox',
        'Add Kafka for all events first, then rewrite services around it, then fix images',
        'Add five read replicas, then a CDN, and leave checkout calls synchronous since they work',
      ],
      correct: [1],
      explanation:
        'Images on local disk block horizontal scaling and inflate egress from the app, so fixing them unlocks everything else, and it is low-risk. Caching then removes most catalog DB load cheaply. Queues then take vendor latency and vendor failures out of checkout. Sharding is far too early and would not fix read load. Kafka plus a rewrite is a large project that targets no measured trigger. Replicas copy read load instead of removing it and ignore the checkout problem.',
      followUps: [
        {
          q: 'The CEO says checkout latency is costing conversions now. Can you reorder?',
          a: 'Yes. The order should follow business impact. A quick stopgap for checkout is to wrap the WhatsApp and invoice calls in 1 s timeouts with a circuit breaker and make them non-blocking: record failures for later replay and return success to the user. That takes a day or two and immediately cuts p99. Then do images and statelessness, then caching, then the proper outbox and queue for side effects.',
        },
      ],
    },
  ],
};

export default topic;
