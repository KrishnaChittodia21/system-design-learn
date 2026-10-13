import type { Topic } from '../../types';

const topic: Topic = {
  id: 'rel-production-judgment',
  phase: 'reliability',
  order: 4,
  title: 'Production Judgment: Avoiding Fallback, Constant Work, Queue Backlogs, Metastable Failures & Rollback-Safe Deploys',
  subtitle:
    'The senior-level instincts from the Amazon Builders\' Library and metastable-failure research: why rarely-run code paths betray you, how constant-work designs remove modes, how queues fall into insurmountable backlogs, why outages outlive their triggers, and how to make every deploy reversible.',
  estimatedMinutes: 110,
  sources: [
    'Amazon Builders\' Library — Avoiding fallback in distributed systems (Jacob Gabrielson)',
    'Amazon Builders\' Library — Reliability, constant work, and a good cup of coffee (Colm MacCárthaigh)',
    'Amazon Builders\' Library — Avoiding insurmountable queue backlogs (David Yanacek)',
    'Amazon Builders\' Library — Ensuring rollback safety during deployments (Sandeep Pokkunuri)',
    'Amazon Builders\' Library — Automating safe, hands-off deployments (Clare Liguori)',
    'Bronson, Aghayev, Charapko, Zhu — Metastable Failures in Distributed Systems (HotOS 2021, doi:10.1145/3458336.3465286)',
    'Huang et al. — Metastable Failures in the Wild (OSDI 2022)',
    'Marc Brooker — Metastability and Distributed Systems (brooker.co.za, 2021)',
    'Nichols & Jacobson — Controlling Queue Delay (CoDel), ACM Queue 2012',
  ],
  tags: ['fallback', 'failover', 'constant-work', 'static-stability', 'queue-backlog', 'age-of-oldest-message', 'metastable-failure', 'sustaining-effect', 'rollback-safety', 'two-phase-deploy', 'one-box', 'bake-time'],
  cheatSheet: [
    'Fallback = a different mechanism for the same result (cache fails → hit DB directly). It is the riskiest failure strategy: rarely exercised, hard to test, often fails itself, and can turn a partial outage into a total one (Amazon retail, ~2001).',
    'Instead of fallback: make the primary path more reliable, let the caller retry, push data ahead of need (IAM credentials valid for hours), or run both paths all the time so "fallback" becomes failover.',
    'Constant work: do the same amount of work whether 0 or 100% of things changed — fixed-size payloads (Route 53 checkers send 10,000 slots even with 10 checks), full-config reloads every few seconds (Hyperplane from S3). No modes, self-heals each cycle.',
    'Edge-triggered (apply deltas/events) needs extra code to become self-healing; level-triggered (reconcile from full desired state) heals any missed or corrupted update on the next pass.',
    'Queues are bimodal: near-zero backlog = fast mode; once arrivals > capacity, latency grows without bound. Drain time = backlog ÷ (capacity − arrival rate); a 1-hour outage needs ~1 hour at 2× capacity to recover.',
    'Alarm on message age (time since enqueue, first attempt only), not depth. Depth is meaningless without throughput; age is directly the customer-visible delay.',
    'Backlog tactics: sideline messages older than a threshold to a backlog queue (fresh-first ≈ LIFO), drop deltas superseded by an anti-entropy sweep, spill over per-tenant excess, shuffle-shard queues, delay queues for throttled workloads, heartbeat visibility timeouts.',
    'Metastable failure: a trigger pushes a system that was efficient-but-vulnerable into a bad state that persists after the trigger is gone, because a sustaining feedback loop (retries, cold look-aside cache, slow error path) keeps goodput near zero. Root cause = the loop, not the trigger.',
    'Hidden capacity is the load you can survive with every optimisation lost (cold cache): 90% hit rate → advertised 10× the DB, hidden = the DB. Running above hidden capacity is the vulnerable state; recovering needs load below it or a broken loop.',
    'Rollback safety: split any format/protocol change into Prepare (read both, write old) → bake days → Activate (write new). Version the serializer, preserve unknown fields, and test upgrade-then-downgrade on a mixed multi-AZ fleet.',
  ],
  sections: [
    {
      heading: '1. The production-judgment lens: modes are where systems die',
      body: `**Intuition:** the code that runs a million times a day is the code you can trust. The code that runs once a year — the fallback, the "emergency mode", the backlog drain, the rollback — is the code that takes you down, because it runs for the first time on the worst day.

Every topic in this chapter is one idea seen from five angles: **a system that behaves differently under stress than in steady state is a system you have never really tested.** The Amazon Builders' Library calls this *modal behaviour*; the metastable-failure paper calls the stressed mode a *metastable state*; queue engineers call it *bimodal latency*.

| Pattern | The hidden mode | The senior move |
|---|---|---|
| Fallback | A second code path that wakes only on failure | Remove it, or run it all the time (failover) |
| Event-driven config/health | Work ∝ number of changes, which spikes in incidents | Constant work: full state, fixed size, every N seconds |
| Queues | Fast mode vs backlog mode with unbounded latency | Measure age, prefer fresh work, plan recovery capacity |
| Optimisations (cache, retries) | Efficient steady state hides a much lower survivable load | Know hidden capacity, break the sustaining loop |
| Deploys | Mixed-version fleet during rollout and rollback | Two-phase prepare/activate, upgrade-downgrade tests |

**How this differs from the earlier reliability topics.** Timeouts, retries, breakers, bulkheads and load shedding (rel-patterns) are *mechanisms*. Cells, static stability and DR (rel-dr) are *topologies*. This chapter is about *judgment*: deciding which mechanism is itself a liability, predicting how a design behaves at 3 a.m. after a trigger, and arguing it in a design review.

**What to say in interviews:** "Before adding a resilience mechanism, I ask how often it will actually run in production. If the answer is 'only during incidents', I either make it run constantly or I don't build it — an unexercised path is a latent bug with a pager attached."`,
      diagram: `   steady state                 under stress
  +-------------+   trigger    +-------------------+
  | primary path| -----------> | rarely-run path    |
  | run 1M/day  |              | fallback, drain,   |
  | well tested |              | rollback, cold cache|
  +-------------+              +-------------------+
        ^                               |
        |   recovery needs a big push   | sustaining loop
        +-------------------------------+ (retries, misses)`,
      keyPoints: [
        'Modal behaviour = different code or work under stress than in steady state.',
        'The less often a path runs, the less you should trust it during an incident.',
        'Judgment = knowing when a resilience mechanism is itself the risk.',
      ],
      source: 'Amazon Builders\' Library — Avoiding fallback; Reliability and constant work',
    },
    {
      heading: '2. Avoiding fallback: why the backup plan is usually the outage',
      body: `**Intuition:** a spare tyre you have never checked is flat precisely when you need it — and in a distributed system, every car's spare goes flat at the same moment.

**Four ways to handle a failed call** (Builders' Library taxonomy):

| Strategy | Example | Exercised in steady state? |
|---|---|---|
| Retry | Call the same endpoint again after backoff | Yes, constantly (and metered) |
| Proactive retry | Send to 3 replicas, take the first 2 answers | Yes, every request |
| Failover | Try another endpoint of the *same* mechanism | Partly (endpoints serve traffic) |
| **Fallback** | Use a *different mechanism* for the same result | **No — only during failures** |

**Why fallback is the riskiest** (the malloc thought experiment): if \`malloc\` fails and you fall back to an SSD-backed allocator, (1) the fallback is nearly impossible to test at the right moment, (2) it can fail too, so you only improved the odds, (3) it is slower and contends with other subsystems on an already-sick machine, (4) its side effects (logging stack traces) change the load profile — a CPU-bound process becomes I/O-bound, and (5) it runs so rarely that nobody remembers how it works. For critical single-host daemons Amazon instead **pre-allocates memory at startup** — removing the failure rather than handling it.

**Distributed systems make it worse:** the fallback fires on *many machines at once*, a combination no single-host test reproduces.

**The canonical Amazon story (~2001):** product pages showed shipping speeds for 25+ products per page, read from a supply-chain database. A local caching process was added on each web server, with a fallback: *if the cache fails, query the database directly*. It worked for months. Then the caches failed at roughly the same time, every web server hit the database, the database locked up, the website went down — and so did fulfilment centres worldwide that depended on that database. The fallback converted a partial outage into a total one. The sharp lesson: **if the database could really handle the direct load, you would not have needed the cache.**

**Fallback vs graceful degradation — the distinction interviewers probe:**
- *Graceful degradation* (rel-patterns §9) **drops an optional feature**: hide recommendations, show bestsellers precomputed and local. The degraded response uses *less* of the system.
- *Fallback* tries to **deliver the same result via another dependency**: same data, different source. It usually uses *more* of a weaker system, at exactly the wrong moment.
- Rule of thumb: degradation that reduces load is safe; a fallback that shifts load onto something not sized for it is a trap.

**What to say:** "I treat a fallback as a design smell. My first question is whether the fallback target is sized for 100% of the traffic it would receive when *every* instance flips at once. If yes, why isn't it the primary? If no, the fallback is a cascading-failure path."`,
      code: [
        {
          language: 'typescript',
          title: 'The anti-pattern in NestJS: a fleet-wide synchronised fallback',
          code: `@Injectable()
export class ShippingEstimateService {
  constructor(
    private readonly cache: ShippingCacheClient,     // sidecar cache per pod
    private readonly supplyChainDb: Pool,            // sized for ~2% of page traffic
  ) {}

  async estimate(productIds: string[]): Promise<Estimate[]> {
    try {
      return await this.cache.getMany(productIds);
    } catch (err) {
      // Looks safe in code review; tested by killing ONE pod's cache.
      // In production the cache dies on all 400 pods together (bad config push,
      // shared dependency, OOM after a release) and 400 pods x 25 ids per page
      // land on a DB sized for a tiny fraction of that. The DB locks up and
      // takes down every OTHER consumer of the supply-chain DB with it.
      return this.queryDbDirectly(productIds);
    }
  }

  private async queryDbDirectly(ids: string[]): Promise<Estimate[]> {
    const { rows } = await this.supplyChainDb.query(
      'SELECT product_id, eta_days FROM shipping_estimates WHERE product_id = ANY($1)',
      [ids],
    );
    return rows;
  }
}`,
        },
      ],
      keyPoints: [
        'Fallback = different mechanism, same result; it runs only during failure.',
        'Single-host tests never reproduce the whole fleet falling back together.',
        'Degradation sheds work; fallback moves work onto something weaker.',
      ],
      source: 'Amazon Builders\' Library — Avoiding fallback in distributed systems',
    },
    {
      heading: '3. What to do instead of fallback: reliable primaries, pushed data, always-on failover',
      body: `**Intuition:** instead of keeping a spare tyre in the boot, drive on run-flat tyres (better primary), or on a car with two engines both always running (failover).

**The Builders' Library alternatives, in order of preference:**

1. **Make the primary path more reliable.** Choose dependencies that are inherently more available rather than stitching a fallback between two data stores (Amazon cites DynamoDB carrying amazon.com through Prime Day 2017). In our stack: Postgres with a synchronous standby and a tested failover is one path; "Postgres, else Mongo snapshot" is two half-tested paths.
2. **Let the caller handle it.** Fail fast with a clear error and let the client's retry logic (with budget and jitter) work. AWS SDKs retry by design; retries are exercised constantly and their rate is alarmed on.
3. **Push data ahead of need.** IAM roles for EC2 push credentials to the host that stay valid for *hours*, so a disruption in the push mechanism does not affect requests at all. The request path never makes a remote call that could fail.
4. **Convert fallback into failover.** If you must have two sources, run both *all the time* — e.g. randomly choose which one answers each request, with both sized for 100%. Then neither path is "the fallback"; both are continuously proven.
5. **Don't let retries become hidden fallback.** Alarm on the retry rate; a retry path that suddenly runs at 30% is an untested mode.
6. **Prefer proactive retry / constant work.** Quorum reads (2 of 3) or hedged requests send the extra load *every* time, so an incident does not change the load shape.

**If a fallback truly cannot be avoided**, exercise it in production as often as possible — a percentage of real traffic every day, with its own SLO dashboards — so it is as proven as the primary.

**Applying it to a NestJS + Postgres stack — pushed data with last-known-good:**
- A publisher writes a full snapshot (entitlements, prices, routing rules) to S3 or a compacted Kafka topic.
- Every pod loads the snapshot into memory on a fixed cadence and **serves only from memory**. If the publisher is down, pods keep serving the last good snapshot and export a \`snapshot_age_seconds\` gauge.
- The request path has **zero remote calls** for this data, so there is no failure to fall back from — only staleness to monitor.

**What to say:** "I'd remove the request-time dependency entirely: push the data to every node, serve from memory, alarm on staleness. That trades freshness — seconds to minutes — for an availability that no longer depends on the config service at all."`,
      code: [
        {
          language: 'typescript',
          title: 'Always-on failover: both PSP routes take real traffic every minute',
          code: `type Route = { name: 'psp-a' | 'psp-b'; weight: number; client: PspClient };

// Both providers carry production traffic continuously (e.g. 80/20), so the
// "secondary" is proven every minute instead of once a year during an outage.
@Injectable()
export class PaymentRouter {
  constructor(private readonly routes: Route[], private readonly health: RouteHealth) {}

  pick(): Route {
    // Health only shifts WEIGHTS between already-live paths; it never wakes a cold one.
    const live = this.routes.filter((r) => this.health.successRate(r.name) > 0.9);
    const pool = live.length ? live : this.routes;          // never route to an empty set
    const total = pool.reduce((s, r) => s + r.weight, 0);
    let x = Math.random() * total;
    for (const r of pool) { if ((x -= r.weight) < 0) return r; }
    return pool[pool.length - 1];
  }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    const route = this.pick();
    // Idempotency key is per order, so a client retry that lands on the other
    // PSP cannot double-charge: each PSP dedupes, and we record the winner.
    return route.client.charge({ ...req, idempotencyKey: req.orderId + ':' + route.name });
  }
}`,
        },
      ],
      keyPoints: [
        'Prefer a more available primary over a primary plus a cold spare.',
        'Push data ahead of need; serve from memory; alarm on snapshot age.',
        'Two always-live paths = failover; one live + one dormant = fallback.',
      ],
      source: 'Amazon Builders\' Library — Avoiding fallback in distributed systems',
    },
    {
      heading: '4. Constant work: the coffee urn, Route 53 health checks and Hyperplane',
      body: `**Intuition:** a barista making one cup per customer collapses during the morning rush; an urn keeps 300 cups hot whether 3 or 300 people show up. The urn's work is O(1) in demand — and, as it empties, it actually does *less* work.

**Three properties of a constant-work design** (Colm MacCárthaigh):
1. It does not scale up or slow down with load or stress.
2. It has **no modes** — the same operations run in every condition.
3. If it varies at all, it does *less* work under stress, never more.

Caches fail this test: an empty cache is a different mode with far more downstream work.

**Route 53 health checks.** Tens of checkers across Regions probe each target every few seconds. Aggregators apply sensitivity logic (e.g. unhealthy only after 3 failed checks). The trick: **each checker sends a result set sized to its maximum capacity** — a checker that supports 10,000 results but has 10 configured still sends 10,000 entries, 9,990 dummies. Aggregators then push a **fixed-size table of every status** to DNS servers every few seconds, and each DNS server evaluates *all* candidate answers against that in-memory table on every query, even after finding a healthy one. Why not event-driven ("on health change, edit DNS records")? Because one AZ failure can flip tens of thousands of checks at once — potentially millions of DNS changes, precisely when the system is stressed. With constant work, an AZ outage changes *bits in a table*, not the amount of work.

**Hyperplane (the engine behind NLB and other VPC services).** Rejected design: customer changes become workflow events — bursts of changes slow propagation, and customer retries add more events. Chosen design: changes are written into a **configuration file in S3**; every Hyperplane node **fetches and fully reloads the whole file every few seconds**, changed or not. The file is **pre-sized to its maximum** with placeholder slots, so a brand-new Region behaves exactly like a mature one. Losing nodes reduces total work rather than causing retries.

**Costs, honestly:** constant work can waste resources (a full urn for three drinkers). For health and config propagation the waste is negligible next to the cost of operating a complex workflow. It is the **wrong** choice for the big, expensive fleet — 100 web servers at peak when half would do off-peak is real money; elastic scaling wins there (and keeps the scaling path exercised).

**What to say:** "For control-plane-to-data-plane propagation I'd use constant work: every node pulls the full desired state on a fixed timer, the payload is fixed-size, and an incident changes values, not volume. That gives me predictable load and self-healing, at the price of some redundant bytes."`,
      diagram: `  Event-driven                     Constant work
  changes ---> workflow ---> nodes  writer --> S3 config.bin (fixed size)
  1/min  ok      queue grows        nodes: every 5s GET + full reload
  10K at once   retries pile up     10K changes = same bytes, same work

  Route 53: checkers --(10,000-slot result, always)--> aggregators
            aggregators --(full status table, every few s)--> DNS servers
            DNS query: evaluate ALL answers vs table (same cost every time)`,
      keyPoints: [
        'No modes: the same work runs during calm and during an AZ outage.',
        'Fixed-size payloads make network and CPU cost independent of what changed.',
        'Constant work fits propagation; elastic scaling fits big expensive fleets.',
      ],
      source: 'Amazon Builders\' Library — Reliability, constant work, and a good cup of coffee',
    },
    {
      heading: '5. Applying constant work in Node: level-triggered reconcilers that heal themselves',
      body: `**Intuition:** an edge-triggered system is a waiter who remembers every change to your order; miss one shout and your order is wrong forever. A level-triggered system re-reads the full order slip every few seconds — a missed shout is fixed on the next glance.

**Edge vs level triggering:**

| | Edge-triggered (deltas/events) | Level-triggered (full state) |
|---|---|---|
| Work per cycle | ∝ number of changes | Constant (size of state) |
| Missed/corrupt update | Wrong until someone notices | Fixed on next cycle |
| Burst of 10K changes | Queue, slow propagation, retries | Same cost as zero changes |
| Needs | Ordering, dedupe, gap detection | A bounded state size |

Kubernetes controllers are level-triggered for this reason: they watch events as *hints* but always reconcile from full desired state.

**Applying it in a Node/Kafka/Postgres stack:**
- **Config and flags:** publisher writes a full, versioned snapshot; pods reload the full thing every 5–30 s and atomically swap a reference. Use a **worker thread or a compact binary format** for parsing if the snapshot is megabytes — a 10 MB \`JSON.parse\` can block the event loop for tens of milliseconds.
- **Kafka compacted topics** are a natural snapshot store (latest value per key), but replaying them is still edge-like; pair with a periodic full rebuild.
- **Health/routing tables:** publish a fixed-length array (one slot per possible member) instead of "member X went down" events.
- **Postgres-driven jobs:** a cron that reconciles *all* rows needing action (\`WHERE state = 'pending' AND updated_at < now() - interval '5 minutes'\`) heals any lost message, where a queue-only design would leave orphans.
- **Guard rails:** keep last-known-good on parse/validation failure, refuse snapshots that shrink drastically (a 90% smaller file is more likely a bug than a real change), and export \`config_version\` and \`config_age_seconds\`.

**What to say:** "Events are great as a latency optimisation, but correctness should come from periodic full reconciliation. If the event path drops something, the next sweep fixes it, so I never need a special recovery mode."`,
      code: [
        {
          language: 'typescript',
          title: 'Constant-work snapshot loader: full reload, last-known-good, staleness metric',
          code: `import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Gauge } from 'prom-client';

const ageGauge = new Gauge({ name: 'routing_snapshot_age_seconds', help: 'Age of applied snapshot' });

export class RoutingSnapshot {
  private current: { version: number; builtAt: number; routes: Map<string, string> } | null = null;

  constructor(private readonly s3: S3Client, private readonly bucket: string) {}

  start(intervalMs = 5_000): void {
    // Same work every tick: fetch the WHOLE file, parse, validate, swap.
    const tick = async () => {
      try {
        const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: 'routing/current.json' }));
        const doc = JSON.parse(await res.Body!.transformToString());
        this.validate(doc);                                   // throws on bad input
        this.current = { version: doc.version, builtAt: doc.builtAt, routes: new Map(doc.routes) };
      } catch {
        // Keep last-known-good. No retries-in-a-loop: the next tick IS the retry.
      } finally {
        if (this.current) ageGauge.set((Date.now() - this.current.builtAt) / 1000);
        setTimeout(tick, intervalMs).unref();
      }
    };
    void tick();
  }

  private validate(doc: { version: number; routes: [string, string][] }): void {
    if (this.current && doc.version < this.current.version) throw new Error('older snapshot');
    if (this.current && doc.routes.length < this.current.routes.size * 0.5)
      throw new Error('snapshot shrank by >50%, refusing');   // likely a publisher bug
  }

  lookup(key: string): string | undefined {
    return this.current?.routes.get(key);                     // request path: memory only
  }
}`,
        },
      ],
      keyPoints: [
        'Correctness from periodic full reconciliation; events only cut latency.',
        'Keep last-known-good and refuse suspicious snapshots.',
        'Measure snapshot age; large parses belong off the event loop.',
      ],
      source: 'Amazon Builders\' Library — Reliability and constant work; Kubernetes controller pattern',
    },
    {
      heading: '6. Queue backlogs are bimodal: the recovery math nobody does up front',
      body: `**Intuition:** a queue is either nearly empty (every message processed in milliseconds) or growing (every message waits behind everything before it). There is almost no middle — and the trip back from "growing" takes as long as the outage that caused it, or longer.

**The mechanics.** With arrival rate λ and maximum processing rate μ:
- If λ < μ, backlog stays near zero; latency ≈ processing time.
- During an outage of length T, backlog B = λ × T.
- After recovery, the backlog drains at the **spare** rate μ − λ, so drain time = B ÷ (μ − λ).
- At μ = 2λ, drain time = λT ÷ λ = **T**: a one-hour outage needs another hour at double capacity. The Builders' Library example: a backlog 10× the consumer's scaled capacity takes ~300 minutes.
- Add **detection time**: humans may take ~30 minutes to engage, during which producers keep enqueueing unthrottled.

**Why FIFO makes it worse for real-time systems:** during a backlog, a FIFO queue serves the *oldest* (least useful) messages first, so *every* customer sees the full delay — including those whose request arrived a second ago. Customers usually prefer fresh work first.

**Measure age, not depth.** Depth of 1M is fine at 100K msgs/s and a disaster at 100 msgs/s. Amazon measures how old messages are when dequeued (from the SQS enqueue timestamp). AWS IoT refines this with **AgeOfFirstAttempt** — age measured only on a message's first delivery, which filters out retries and intentionally slow readers and makes a clean early-warning signal. DLQ volume is a lagging indicator (alarm on any DLQ message, but don't make it the primary signal).

**Applying it:**
- **SQS:** alarm on \`ApproximateAgeOfOldestMessage\`, and also emit your own \`now − SentTimestamp\` histogram when \`ApproximateReceiveCount = 1\`.
- **Kafka:** convert offset lag into **time lag** (kafka-lag-exporter or Burrow estimate it from produce-rate interpolation), or put a produce timestamp in headers and record consume-time age per partition.

**What to say:** "I size recovery capacity explicitly: worst plausible outage plus detection time, times arrival rate, divided by spare capacity, and I check the downstream DB can take the drain rate. If that number is hours, I need fresh-first processing or the ability to drop stale work, not just more consumers."`,
      code: [
        {
          language: 'yaml',
          title: 'Prometheus alerts on age, not depth (kafka-lag-exporter + app histogram)',
          code: `groups:
  - name: queue-age
    rules:
      # Time lag per consumer group, estimated by kafka-lag-exporter
      - alert: OrderProjectorFallingBehind
        expr: max by (group) (kafka_consumergroup_group_max_lag_seconds{group="order-projector"}) > 120
        for: 5m
        labels: { severity: page }
        annotations:
          summary: 'order-projector is {{ $value | humanizeDuration }} behind'

      # App-side: age at FIRST attempt only (retries excluded), p99 over 5m
      - alert: NotificationAgeFirstAttemptHigh
        expr: |
          histogram_quantile(0.99,
            sum by (le) (rate(queue_message_age_first_attempt_seconds_bucket{queue="notifications"}[5m]))
          ) > 60
        for: 10m
        labels: { severity: page }

      # Drain-time estimate: depth / (consume rate - produce rate); alert if > 1h
      - alert: BacklogInsurmountable
        expr: |
          sum(sqs_approximate_number_of_messages_visible{queue="notifications"})
            / clamp_min(sum(rate(app_messages_processed_total{queue="notifications"}[10m]))
                      - sum(rate(app_messages_enqueued_total{queue="notifications"}[10m])), 1)
          > 3600
        for: 10m`,
        },
      ],
      keyPoints: [
        'Drain time = backlog ÷ (capacity − arrivals); at 2× capacity it equals the outage length.',
        'Include ~30 min of detection time in the backlog estimate.',
        'Alarm on age at first attempt; depth alone means nothing.',
      ],
      source: 'Amazon Builders\' Library — Avoiding insurmountable queue backlogs',
    },
    {
      heading: '7. Backlog-tolerant queue design: fresh-first, drop the superseded, isolate the noisy',
      body: `**Intuition:** when the post office is buried, deliver today's letters first, shred the flyers that are already out of date, and give the one customer who mailed 10,000 parcels their own counter.

**Tactics from the Builders' Library, and when each fits:**

| Tactic | Mechanism | Fits when | Watch out for |
|---|---|---|---|
| **Sideline old traffic** | On dequeue, if age > threshold, move to a *backlog queue*; drain it only when the live queue is caught up | Freshness matters (notifications, telemetry, device state) | Per-entity ordering breaks; backlog can starve |
| **TTL / drop superseded** | If a periodic full sweep (anti-entropy) ran after the message was produced, the message is redundant — drop it | You already have level-triggered reconciliation | Only drop what the sweep provably covered |
| **Spillover queue** | Consumer-side throttle per customer; excess moved to a spillover queue and deleted from primary | Multi-tenant fairness on a shared queue | Spillover needs its own age alarm |
| **Per-customer queues** | One queue per tenant | A handful of tenants | Polling N queues gets expensive |
| **Shuffle-sharded queues** (Lambda async) | Fixed set of queues; each customer hashed to a small subset; enqueue to the least-full of its subset | Thousands of tenants | Rare full-overlap neighbours still affected |
| **Delay queue** | Re-enqueue a throttled workload with a delivery delay of minutes | Slowing one workload without dropping it | Adds latency to that workload by design |
| **Backpressure** | Producers reject more as the workload's backlog grows (throttle ∝ 1/depth) | You can see per-workload depth | A shared SQS queue only reports total depth |

**Ordering caveats.** The Builders' Library warns that SQS FIFO searches only a bounded window of unprocessed messages (~20,000 when the article was written; check today's quotas) for available message groups, so one group with a huge backlog can starve groups holding fresh messages. For Kafka, "sideline" means publishing to a \`*.backlog\` topic — keep a **per-key version** in the payload and make the consumer apply only if \`version > stored_version\`, so out-of-order arrival is harmless.

**When not to drop:** Amazon's own order pipeline prefers to *accept* orders during backlogs and prioritise urgent ones behind the scenes. Money-moving or legally required messages get prioritised, never TTL'd.

**What to say:** "I'd classify messages as *state* (latest value wins — safe to drop if superseded) or *commands* (each must happen — never drop, only reorder by urgency). That classification decides which backlog tactics are legal."`,
      code: [
        {
          language: 'typescript',
          title: 'SQS consumer: fresh-first with a sidelined backlog queue and superseded-delta drops',
          code: `const LIVE_MAX_AGE_MS = 5 * 60_000;

async function handle(msg: Message): Promise<void> {
  const sentAt = Number(msg.Attributes!.SentTimestamp);
  const firstAttempt = msg.Attributes!.ApproximateReceiveCount === '1';
  if (firstAttempt) ageFirstAttempt.observe((Date.now() - sentAt) / 1000);

  const evt = JSON.parse(msg.Body!) as { deviceId: string; version: number; state: unknown };

  // 1. Superseded by the nightly anti-entropy sweep? Then it carries no information.
  const sweep = await sweeps.lastCompleted();            // { snapshotReadAt: epoch ms }
  if (sweep && sentAt < sweep.snapshotReadAt) return ack(msg, 'dropped_superseded');

  // 2. Too old for the live lane? Sideline it so fresh messages are not stuck behind it.
  if (Date.now() - sentAt > LIVE_MAX_AGE_MS) {
    await sqs.send(new SendMessageCommand({ QueueUrl: BACKLOG_URL, MessageBody: msg.Body! }));
    return ack(msg, 'sidelined');                        // delete only AFTER the send succeeded
  }

  // 3. Apply idempotently and order-safely: an older version can never overwrite a newer one.
  await db.query(
    'UPDATE device_state SET state = $2, version = $3 WHERE device_id = $1 AND version < $3',
    [evt.deviceId, evt.state, evt.version],
  );
  return ack(msg, 'applied');
}
// A separate poller drains BACKLOG_URL only while live-queue age is < 30 s,
// but always with a small reserved share (e.g. 10% of workers) so it cannot starve.`,
        },
      ],
      keyPoints: [
        'State messages can be dropped if superseded; commands can only be reordered.',
        'Sideline old work so fresh work is not stuck behind it; reserve a share for the backlog.',
        'Version checks make out-of-order delivery safe.',
      ],
      source: 'Amazon Builders\' Library — Avoiding insurmountable queue backlogs',
    },
    {
      heading: '8. Consumers under backlog: leases, heartbeats, in-flight limits and Little\'s law',
      body: `**Intuition:** a backlog is exactly when your consumers are slowest — so every timeout you tuned for the happy path is now wrong, and the system can start doing every job twice.

**The visibility-timeout "fork bomb."** An SQS consumer has a visibility timeout of 30 s, tuned for a 5 s p50. In a backlog the downstream slows to 40 s per message. The message becomes visible again before the first worker finishes; a second worker picks it up; now *two* workers hammer the slow downstream, making it slower still, so more messages time out and get duplicated. Fix: workers **heartbeat** (\`ChangeMessageVisibility\`) while working, and **stop work** if they can no longer extend the lease.

**Little's law sets the thread/connection count.** Concurrency = arrival rate × latency. 100 msgs/s at 100 ms needs ~10 concurrent workers; at 10 s latency the same rate needs ~1,000. Since latency balloons during incidents, unbounded concurrency means unbounded sockets and memory. Cap it **per workload** (semaphores or per-workload pools) so one slow tenant cannot take every slot.

**Other consumer hygiene from the Builders' Library:**
- **In-flight limits:** SQS caps in-flight messages per queue (120,000 for standard queues). Code that forgets to delete messages after errors keeps them in flight until the timeout, silently eating that budget. Move problem messages to another queue instead of letting them churn.
- **Empty-poll ratio:** if *every* receive returns messages, pollers have no headroom for a burst. Track the share of empty receives; near 0% means add pollers.
- **Protect every layer:** queued work bypasses front-door admission control, so each async component needs its own overload protection.
- **DLQs + alarms:** any DLQ message pages; redrive after the fix.

**Applying it in NestJS/KafkaJS:** Kafka has no per-message visibility; the equivalent is \`max.poll.interval.ms\` / KafkaJS \`sessionTimeout\` and calling \`heartbeat()\` inside long \`eachBatch\` loops. Bound concurrency with \`partitionsConsumedConcurrently\` and a per-tenant semaphore around downstream calls.

**What to say:** "I size consumer concurrency with Little's law at the *incident* latency, not the median, and I make the lease outlive slow processing via heartbeats — otherwise a backlog turns into duplicate work that deepens the backlog."`,
      code: [
        {
          language: 'typescript',
          title: 'Visibility heartbeat with a hard cap and cooperative cancellation',
          code: `async function processWithLease(msg: Message, work: (signal: AbortSignal) => Promise<void>) {
  const ctrl = new AbortController();
  const VISIBILITY_S = 30;
  const MAX_TOTAL_MS = 10 * 60_000;      // never hold a message forever
  const started = Date.now();

  const beat = setInterval(async () => {
    if (Date.now() - started > MAX_TOTAL_MS) return ctrl.abort(new Error('lease cap reached'));
    try {
      await sqs.send(new ChangeMessageVisibilityCommand({
        QueueUrl: QUEUE_URL, ReceiptHandle: msg.ReceiptHandle!, VisibilityTimeout: VISIBILITY_S,
      }));
    } catch (err) {
      ctrl.abort(err);                    // lease lost: another worker may already have it
    }
  }, (VISIBILITY_S * 1000) / 3);          // extend at 1/3 of the timeout

  try {
    await tenantLimiter.run(tenantOf(msg), () => work(ctrl.signal)); // per-tenant concurrency cap
    if (!ctrl.signal.aborted) await deleteMessage(msg);
  } finally {
    clearInterval(beat);
  }
}`,
        },
      ],
      keyPoints: [
        'A lease shorter than incident-time processing duplicates work and deepens the backlog.',
        'Size concurrency by Little\'s law at incident latency, and cap per workload.',
        'Track empty-poll ratio and in-flight counts; every async layer needs overload protection.',
      ],
      source: 'Amazon Builders\' Library — Avoiding insurmountable queue backlogs',
    },
    {
      heading: '9. Metastable failures: when the outage outlives its trigger',
      body: `**Intuition:** a traffic jam that started with one stalled car keeps going long after the car is towed, because the jam itself now makes everyone brake. The tow truck (removing the trigger) is not the fix.

**The model** (Bronson, Aghayev, Charapko, Zhu — HotOS 2021):
- **Stable state:** a trigger causes errors that resolve when it goes away.
- **Vulnerable state:** above some invisible load threshold the system is *healthy and efficient* — and many production systems run here all the time *because* it is efficient — but a trigger can tip it over.
- **Metastable state:** goodput is near zero, and a **sustaining effect** — a feedback loop, usually involving **work amplification** or lower efficiency — keeps it there even after the trigger is removed. Leaving needs a strong push: dramatically cutting load, or changing the policy that drives the loop.

Not metastable: a DDoS or livelock that ends when its cause ends.

**The paper's case studies (with its numbers):**
1. **Request retries.** A database answers in < 100 ms below 300 QPS; the app sends one retry if a query takes > 1 s. At 280 QPS a 10-second network outage makes clients time out and retransmit; when connectivity returns, the surge raises latency, so every query times out and is retried → 560 QPS offered, zero goodput. The system is stable below 150 QPS (where even doubled load fits). To recover you must cut load below 150 QPS or limit retries. Related: **failover** under sharding can spread a point failure across replicas into a total outage.
2. **Look-aside cache.** With a 90% hit rate the app serves 3,000 QPS against a 300-QPS database. Lose the cache while above 300 QPS and every miss times out; because the *application* fills the cache only on success, the cache stays empty forever. A 90% hit rate means a 10× query amplification on loss.
3. **Slow error handling.** The success path is RAM-only; the error path captures stack traces, does DNS lookups, writes to disk and ships logs. Under failure, each request costs more of the very resource that is short.
4. **Link imbalance (Facebook).** Cache-miss spikes raced across aggregated links; a connection pool's **MRU policy** reshuffled so the most congested link's connections sat on top, pulling more traffic onto it. It defied diagnosis for **over two years**, was "fixed" several times, and the real fix was a **one-line change** to the pool policy.

**Why removing the trigger doesn't help:** the loop is self-sustaining. Postmortems that name the trigger ("network blip", "Redis failover") as root cause leave the loop intact for the *next* trigger. The paper's position: **the root cause is the sustaining effect.**

**Common sustaining loops in a Node/Postgres stack:** client and SDK retries stacked across layers; cold Redis plus app-side fill; GC pressure from piling up in-flight promises (more memory → longer GC pauses → slower requests → more in-flight); connection-pool queueing where queued requests have already timed out upstream; Kafka rebalance storms where slow processing exceeds \`max.poll.interval.ms\`, triggering rebalances that stall processing further.`,
      diagram: `  goodput
    ^            advertised capacity (with cache/retries "helping")
    |                      .----------.
    |                 .---'            \\  trigger
    |            .---'  VULNERABLE      \\
    |   STABLE .'                        v
    |       .-'                    METASTABLE: high work, ~0 goodput
    |    .-'   hidden capacity     <-- sustaining loop keeps it here
    +--------------|-------------------------------> offered load
          recovery: load must drop BELOW hidden capacity`,
      keyPoints: [
        'Vulnerable state is efficient, which is why systems run there.',
        'Sustaining effect = feedback loop with work amplification; it is the root cause.',
        'Recovery needs load below hidden capacity or a policy change that breaks the loop.',
      ],
      source: 'Bronson et al. — Metastable Failures in Distributed Systems (HotOS 2021); Brooker — Metastability and Distributed Systems',
    },
    {
      heading: '10. Breaking metastable loops: characteristic metrics, hidden capacity and goodput-first policies',
      body: `**Intuition:** you can't stop every stalled car, but you can make sure a jam dissolves on its own — and you can put a gauge on the dashboard that shows when you're close to the jam-forming speed.

**Measure the loop, not just the symptoms.**
- **Characteristic metric:** a metric the trigger pushes out of range that *only returns to normal once the metastable state ends* — the memory of the feedback loop. For the retry and cache cases: database latency or the fraction of requests timing out. Others seen in production: queueing delay, cache hit rate, working-set size, page faults, timeout rates, thread counts, lock contention, connection counts, operation mix. Queueing delay is more robust to workload change than raw QPS.
- **Hidden capacity:** the boundary between stable and vulnerable — the load you survive with the optimisation gone. In the cache example, advertised capacity is 3,000 QPS but hidden capacity is 300 QPS. Measure it by stress-testing at a load, applying a trigger, and checking whether the characteristic metric recovers *without intervention*.
- **Trigger intensity:** near hidden capacity even big triggers self-heal; near advertised capacity tiny ones don't (the paper: recoverable from a much larger spike at 151 QPS than at 299 QPS).

**Mitigations surveyed by the paper:**
- **Change policy during overload:** disable retries/failover or apply retry budgets, switch to **LIFO** so some requests meet their deadline, shrink queues, shed load. Detect *persistent* overload rather than spikes with **CoDel-style minimum queueing delay over a sliding window**: if the minimum stays high, the queue never drained. Marc Brooker's caution: adaptive policy is itself a *mode*, harder to reason about — prefer mechanisms that are always on (retry budgets, deadlines).
- **Prioritisation:** give retried work lower priority so first attempts succeed. A **read-through cache** can let cache fills run with a permissive timeout even when the user request gave up, so the hit rate climbs back; a look-aside cache cannot enforce this. Beware: one geo-distributed system that added retries and failover destinations for steady-state reliability reached **> 100× worst-case work amplification** and fell into a metastable state anyway.
- **Fast error paths:** ship errors to a dedicated logging thread through a bounded lock-free queue; on overflow just increment a counter; sample stack traces.
- **Outlier hygiene:** the same root cause often shows up first as latency outliers — chase them.
- **Autoscaling** helps by keeping a buffer, but reconfiguration (state transfer, cache warm-up) temporarily *reduces* capacity, so it is rarely fast enough to break a loop by itself.
- **Organisational incentives:** an optimisation that reclaims database capacity because the cache got better makes the system *more* vulnerable (running at a bigger multiple of hidden capacity); reducing cold misses is a true capacity win.

**What to say:** "I'd define a characteristic metric — say DB p50 queueing delay — alarm on its safe range, test that the system self-recovers from a trigger at peak load, and make every amplifying mechanism bounded: retry budgets, deadline propagation, LIFO under persistent overload, and cache fills decoupled from request timeouts."`,
      code: [
        {
          language: 'typescript',
          title: 'Goodput-first admission: CoDel-style persistent-overload detector switching to LIFO',
          code: `type Job = { enqueuedAt: number; deadline: number; run: () => Promise<void> };

export class AdaptiveQueue {
  private q: Job[] = [];
  private windowMin = Infinity;          // min sojourn time seen in current window
  private windowStart = Date.now();
  private overloaded = false;

  constructor(private readonly targetMs = 20, private readonly windowMs = 2_000, private readonly maxLen = 5_000) {}

  push(job: Job): boolean {
    if (this.q.length >= this.maxLen) return false;          // shed: fast 503, not a slow timeout
    this.q.push(job);
    return true;
  }

  next(): Job | undefined {
    const now = Date.now();
    // Overloaded => newest first (LIFO): recent callers are still waiting; old ones gave up.
    let job = this.overloaded ? this.q.pop() : this.q.shift();
    while (job && job.deadline <= now) job = this.overloaded ? this.q.pop() : this.q.shift(); // drop expired work
    if (!job) return undefined;

    this.windowMin = Math.min(this.windowMin, now - job.enqueuedAt);
    if (now - this.windowStart >= this.windowMs) {
      // If even the FASTEST job waited longer than target for a whole window,
      // the queue never drained: persistent overload, not a burst.
      this.overloaded = this.windowMin > this.targetMs;
      this.windowMin = Infinity;
      this.windowStart = now;
    }
    return job;
  }
}`,
        },
      ],
      keyPoints: [
        'Characteristic metric = the loop\'s memory; alarm on its safe range.',
        'Know hidden vs advertised capacity; test self-recovery at peak.',
        'Bound every amplifier; decouple cache fills from request deadlines.',
      ],
      source: 'Bronson et al. (HotOS 2021) §3–4; Nichols & Jacobson — CoDel; Huang et al. — Metastable Failures in the Wild (OSDI 2022)',
    },
    {
      heading: '11. Rollback safety: two-phase prepare/activate for formats and protocols',
      body: `**Intuition:** before you start writing letters in a new language, make sure everyone who might read them — including the old version of you after a rollback — can already read that language.

**The guiding tenet:** avoid walking through one-way doors. Assume old and new versions each work alone; the question is whether **moving forward or backward through a mixed fleet** causes errors. In a distributed system, rolling deploys mean mixed versions *always* exist for a while, communicating via RPC and shared state.

**Protocol and format changes are the #1 rollback blocker:**
- **Compression/format:** once v2 writes compressed (or JSON instead of XML, or protobuf instead of JSON) data, v1 cannot read it — rolling back now breaks reads.
- **Innocent constants:** raising a heartbeat period from 5 s to 10 s looks like a one-number edit, but old receivers expecting a heartbeat within ~5 s close connections from new senders — a fleet-wide availability drop.

**Two-phase deployment (the XML → JSON example):**
1. **Prepare (v2):** every server can *read* JSON but still *writes* XML. Nothing changes operationally; rollback is trivially safe because no JSON exists.
2. **Bake** — typically a few days — and **verify 100% of servers** run Prepare. Don't trust a tool that reports success at a minimum-healthy-hosts threshold (e.g. CodeDeploy \`minimumHealthyHosts\`): one straggler still on v1 will choke on JSON.
3. **Activate (v3):** servers start writing JSON. Rolling back to v2 leaves mixed XML/JSON, which v2 reads fine.
4. **Backfill**, then remove XML read support only after every stored object is rewritten.

Heartbeat version: Prepare = accept a 10 s window while still sending every 5 s; Activate = send every 10 s.

**Serialization hygiene:** use established formats (JSON, Protocol Buffers, FlatBuffers) rather than custom ones; give the serializer an **explicit version independent of the build version**, store it with the data and emit metrics for versions read and written; don't serialize types you don't control (reflection over framework collections); **tolerate and preserve unknown fields**, which can make two phases unnecessary.

**Testing — upgrade-downgrade tests:** a multi-server, multi-AZ test environment (a single-server env once hid a bug), the *same deployment configuration* as prod (deploy-all-at-once hid a roll-forward bug), the same service ordering, continuous traffic that exercises every API, workflow and batch job at least once per stage. Stages: deploy to ~half the fleet → complete → roll back fully. Note ordering: roll forward readers before writers; roll back writers before readers.

**Applying it:** Kafka event schema changes (add a field = Prepare consumers first), Redis value format changes (store \`v\` in the value), JWT claim changes, Postgres JSONB document shape. (DB *schema* expand/contract is covered in deployment-infra §11; this is the same idea for every other byte you persist or send.)`,
      code: [
        {
          language: 'typescript',
          title: 'Versioned Redis value codec: Prepare reads v1+v2, a flag Activates writing v2',
          code: `import { gunzipSync, gzipSync } from 'node:zlib';

// The first byte is the codec version, independent of the app build version.
const V1_JSON = 0x01;
const V2_GZIP_JSON = 0x02;

export function decode(buf: Buffer): unknown {
  const v = buf[0];
  codecReads.inc({ version: String(v) });               // metric: which versions are in the wild
  if (v === V1_JSON) return JSON.parse(buf.subarray(1).toString('utf8'));
  if (v === V2_GZIP_JSON) return JSON.parse(gunzipSync(buf.subarray(1)).toString('utf8'));
  throw new Error('unknown codec version ' + v);         // fail loudly, never guess
}

export function encode(value: unknown, flags: Flags): Buffer {
  const json = Buffer.from(JSON.stringify(value), 'utf8');
  // Release N (Prepare): flag OFF everywhere, so we still write v1 but can read v2.
  // Release N+1 or flag flip (Activate): only after 100% of pods report the Prepare build
  // and a bake of a few days. Rolling back the flag leaves v1+v2 values: still readable.
  if (flags.isOn('cache-codec-v2')) {
    codecWrites.inc({ version: '2' });
    return Buffer.concat([Buffer.from([V2_GZIP_JSON]), gzipSync(json)]);
  }
  codecWrites.inc({ version: '1' });
  return Buffer.concat([Buffer.from([V1_JSON]), json]);
}`,
        },
      ],
      keyPoints: [
        'Prepare (read new, write old) → verify 100% → bake → Activate (write new).',
        'Version the serializer separately from the build; preserve unknown fields.',
        'Upgrade-downgrade test on a mixed multi-AZ fleet with prod deploy config.',
      ],
      source: 'Amazon Builders\' Library — Ensuring rollback safety during deployments',
    },
    {
      heading: '12. Hands-off deployments: one-box, waves, bake time and alarm-driven rollback',
      body: `**Intuition:** release like a careful chef tasting a new recipe — one spoon (one box), then one table (one AZ), then one restaurant (one Region), waiting long enough between each to notice indigestion.

**Amazon's pipeline shape (Clare Liguori):**
- **Source → build → test → prod**, with separate pipelines for code, infrastructure, config/flags and OS patches. Pre-prod has **alpha, beta** (functional/end-to-end) and **gamma** (production-like, multi-Region); some add a **zeta** stage checking backward compatibility against prod endpoints.
- **One-box** first in gamma and in every production wave: a single VM/container/small share of invocations, typically **≤ ~10% of requests**, with alarms scoped to that box alone. Negative impact → automatic rollback, no promotion.
- **Waves:** wave 1 = one low-traffic Region, wave 2 = one high-traffic Region, then 3 Regions in parallel, then up to 12, then the rest — and within each Region, **one AZ or cell at a time**. Rolling updates replace at most ~33% of boxes at once, keeping ≥ 66% healthy.
- **Bake time:** at least **1 hour** after each one-box, at least **12 hours** after the first regional wave, **2–4 hours** after later waves, often plus a minimum request count before promotion (a quiet hour at 3 a.m. proves nothing).
- **Alarms drive rollback:** high-severity alarms (faults, latency, CPU, memory, health checks) page and roll back; an **aggregate team alarm** in a Region rolls back *all* of the team's in-flight deployments there; anomaly detection catches a sudden *drop* in request count too. Rollback redeploys the previous immutable artifact.
- **Blockers and windows:** no deploy starts while the aggregate or org-wide alarms fire (overridable to ship a fix); no deploys nights, weekends, holidays, and often Fridays/late afternoons. A typical change reaches all Regions in **about four to five business days**.

**Why it belongs in a "judgment" chapter:** hands-off deployment is constant work applied to change — every deploy follows the same path, so the rollback path is exercised constantly and is never a special mode. It only works if every change is **rollback-safe** (§11).

**Applying it to a Node/K8s stack in India:** wave 1 = one AZ of \`ap-south-2\` (Hyderabad) at low traffic, wave 2 = \`ap-south-1\` (Mumbai) one AZ at a time; Argo Rollouts canary with a one-pod step and an AnalysisTemplate on pod-scoped error rate; bake windows that avoid IPL-final evenings and sale days.`,
      code: [
        {
          language: 'yaml',
          title: 'Wave plan with one-box, bake times and alarm gates (pipeline config sketch)',
          code: `pipeline: orders-api
blockers:
  - alarm: team-orders-aggregate          # any child alarm in ALARM blocks new deploys
  - alarm: org-sev2-or-higher
windows: { allow: 'Mon-Thu 10:00-16:00 IST', exclude: [holidays, 'sale-days'] }
stages:
  - name: gamma
    regions: [ap-south-1]
    steps: [{ onebox: { traffic: 5%, bake: 1h } }, { fleet: { maxUnavailable: 33%, bake: 1h } }]
  - name: wave-1-low-traffic
    regions: [ap-south-2]
    steps:
      - onebox: { traffic: 5%, bake: 1h, minRequests: 20000 }
      - perAZ: { order: [aps2-az1, aps2-az2, aps2-az3], bakeEach: 1h }
    bakeAfter: 12h                         # first production wave bakes longest
  - name: wave-2-high-traffic
    regions: [ap-south-1]
    steps:
      - onebox: { traffic: 5%, bake: 1h, minRequests: 50000 }
      - perAZ: { order: [aps1-az1, aps1-az2, aps1-az3], bakeEach: 2h }
    bakeAfter: 4h
rollback:
  triggerOn:
    - onebox-scoped: 'sum(rate(http_requests_total{pod=~"$ONEBOX",code=~"5.."}[5m])) / sum(rate(http_requests_total{pod=~"$ONEBOX"}[5m])) > 0.01'
    - anomaly: request_count_drop_pct > 30
  action: redeploy-previous-artifact`,
        },
      ],
      keyPoints: [
        'One-box → one AZ → one Region → waves; bake longest after the first wave.',
        'Alarms (including box-scoped and request-drop) trigger automatic rollback.',
        'Hands-off deploys require every change to be rollback-safe.',
      ],
      source: 'Amazon Builders\' Library — Automating safe, hands-off deployments',
    },
  ],
  codeChallenges: [
    {
      id: 'rel-production-judgment-cc-1',
      title: 'Entitlement guard with a "safe" fallback that takes the platform down',
      context:
        'A NestJS guard checks whether a tenant\'s plan includes a feature on every request (≈ 18K RPS across 240 pods). It calls the entitlements service; on any error it falls back to querying the billing Postgres directly. The billing DB is sized for ~600 QPS of billing traffic. Last month an entitlements deploy failed health checks for 4 minutes and the billing DB fell over, taking invoicing and the payment webhooks down with it for 50 minutes.',
      task:
        'Redesign the guard so that an entitlements-service outage cannot reach the billing database, the request path makes no remote call for entitlements, and staleness is visible and bounded. Keep the behaviour correct for plan upgrades within about a minute.',
      starter: {
        language: 'typescript',
        code: `@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly http: HttpService,
    @Inject('BILLING_PG') private readonly billingDb: Pool,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.get<string>('feature', ctx.getHandler());
    const tenantId = ctx.switchToHttp().getRequest().user.tenantId;
    try {
      const res = await firstValueFrom(
        this.http.get('http://entitlements/v1/tenants/' + tenantId + '/features'), // no timeout
      );
      return res.data.features.includes(feature);
    } catch {
      // Fallback: billing DB is the source of truth anyway
      const { rows } = await this.billingDb.query(
        'SELECT f.code FROM plan_features f JOIN subscriptions s ON s.plan_id = f.plan_id WHERE s.tenant_id = $1',
        [tenantId],
      );
      return rows.some((r) => r.code === feature);
    }
  }
}`,
      },
      hints: [
        'When entitlements fails, how many of the 240 pods fall back at the same moment, and what QPS lands on a DB sized for 600?',
        'Entitlements change rarely (plan upgrades). Could every pod hold the whole tenant → features map in memory?',
        'How do you keep refreshing that map with the same amount of work every cycle, and what do you do when a refresh fails?',
      ],
      solution: {
        language: 'typescript',
        code: `// Publisher (runs in the entitlements service, NOT in the request path):
// every 30 s it writes a FULL snapshot { version, builtAt, tenants: { [id]: string[] } }
// to s3://entitlements-snapshots/current.json. Plan changes appear within one cycle.

@Injectable()
export class EntitlementSnapshot implements OnModuleInit {
  private byTenant = new Map<string, Set<string>>();
  private version = 0;
  private builtAt = 0;
  private readonly age = new Gauge({ name: 'entitlements_snapshot_age_seconds', help: 'snapshot age' });

  constructor(private readonly s3: S3Client) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();                          // fail startup (readiness) if we have nothing at all
    if (!this.version) throw new Error('no entitlement snapshot available');
    setInterval(() => void this.refresh(), 15_000).unref(); // constant work: full reload every 15 s
  }

  private async refresh(): Promise<void> {
    try {
      const obj = await this.s3.send(new GetObjectCommand({ Bucket: 'entitlements-snapshots', Key: 'current.json' }));
      const doc = JSON.parse(await obj.Body!.transformToString());
      if (doc.version <= this.version) return;     // never go backwards
      const next = new Map<string, Set<string>>();
      for (const [id, feats] of Object.entries(doc.tenants as Record<string, string[]>)) next.set(id, new Set(feats));
      if (this.byTenant.size && next.size < this.byTenant.size * 0.5) throw new Error('snapshot shrank >50%');
      this.byTenant = next;                        // atomic reference swap
      this.version = doc.version;
      this.builtAt = doc.builtAt;
    } catch (err) {
      snapshotRefreshFailures.inc();               // keep last-known-good; next tick retries
    } finally {
      if (this.builtAt) this.age.set((Date.now() - this.builtAt) / 1000);
    }
  }

  has(tenantId: string, feature: string): boolean | undefined {
    const feats = this.byTenant.get(tenantId);
    return feats ? feats.has(feature) : undefined; // undefined = tenant unknown to this snapshot
  }
}

@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly snap: EntitlementSnapshot, private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const feature = this.reflector.get<string>('feature', ctx.getHandler());
    const tenantId = ctx.switchToHttp().getRequest().user.tenantId;
    const allowed = this.snap.has(tenantId, feature);
    if (allowed === undefined) {
      // Brand-new tenant not in the snapshot yet: deny with a retryable error,
      // instead of opening a request-time path to billing.
      throw new ServiceUnavailableException({ code: 'ENTITLEMENTS_PENDING', retryAfterSeconds: 30 });
    }
    return allowed;
  }
}`,
      },
      explanation: `**What changed and why:**
- **Removed the fallback.** The catch block sent every pod to the billing DB at once — 18K RPS onto a 600-QPS database, the 2001 Amazon cache story in miniature. There is now no request-time path to billing at all.
- **Pushed data ahead of need.** Entitlements are small and change rarely, so the whole map lives in memory on every pod. The request path is a \`Map\` lookup (sub-microsecond) with no network call, timeout or failure mode.
- **Constant work.** Every pod reloads the *full* snapshot every 15 s whether or not anything changed. A missed or bad refresh is healed on the next tick; there is no event backlog after an entitlements outage.
- **Last-known-good plus guard rails.** Parse or validation failures keep the previous snapshot. Version must increase, and a snapshot that shrinks by more than half is refused as a probable publisher bug.
- **Visible staleness.** \`entitlements_snapshot_age_seconds\` gets an alarm (e.g. > 5 min). An entitlements outage now shows up as a staleness alarm, not as a billing outage.
- **Explicit unknown-tenant behaviour.** A tenant created seconds ago gets a retryable 503 for up to one cycle, a deliberate and bounded trade-off rather than a hidden DB path.
- **Startup refuses to serve with nothing.** Readiness depends on having *some* snapshot, so a cold pod never takes traffic with an empty map.`,
      followUps: [
        {
          q: 'Product says a plan upgrade must take effect within 5 seconds, not 30–45. How do you get there without reintroducing a request-time dependency?',
          a: 'Keep the full snapshot as the correctness path and add a **hint channel** for latency: the billing service publishes "tenant X changed" to a Kafka topic or Redis pub/sub, and pods that receive it pull just that tenant\'s entry (or trigger an early full reload). If the hint is lost, the next 15 s full reload still fixes it, so the event path stays an optimisation, never a dependency. For the paying user, the upgrade response can also return a short-lived signed token carrying the new plan, which the guard accepts until the snapshot catches up.',
        },
        {
          q: 'The snapshot grows to 80 MB as you pass 2 million tenants. What breaks first, and how do you keep the design?',
          a: 'First the event loop: `JSON.parse` on 80 MB blocks for hundreds of milliseconds every 15 s, adding p99 latency, and briefly needing roughly 2–3× the heap. Next is bandwidth: 240 pods × 80 MB ÷ 15 s ≈ 1.3 GB/s from S3. Fixes that keep constant work: a compact binary format (a sorted tenant-id array plus feature bitsets) parsed in a `worker_thread` and handed over as a transferable buffer, sharding the snapshot by tenant-hash so a pod loads only the cells it serves, and using conditional GETs with ETag only if the full fetch cost becomes material.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-cc-2',
      title: 'Device-state SQS consumer that cannot climb out of a backlog',
      context:
        'An IoT platform pushes device "desired state" deltas through SQS (standard queue) to a worker fleet that writes Postgres and calls a device gateway. Normal: 3K msgs/s, processing p50 4 s. After a 40-minute gateway outage, the queue holds 7M messages, age of oldest is 2 hours and still rising, the gateway is at 100% CPU, and the same messages are being processed several times. A full reconciliation sweep of all devices runs every night at 02:00.',
      task:
        'Fix the consumer so the system recovers on its own: fresh deltas first, no redundant or superseded work, no duplicate parallel processing, bounded pressure on the gateway, and metrics that show recovery progress.',
      starter: {
        language: 'typescript',
        code: `// visibility timeout on the queue: 30 s
export async function pollLoop(): Promise<void> {
  for (;;) {
    const res = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL, MaxNumberOfMessages: 10, WaitTimeSeconds: 20,
    }));
    // Fire and forget: maximise throughput
    for (const msg of res.Messages ?? []) void handle(msg);
  }
}

async function handle(msg: Message): Promise<void> {
  const delta = JSON.parse(msg.Body!);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await gateway.applyDesiredState(delta.deviceId, delta.state); // ~4 s normally, 40 s when overloaded
      await db.query('UPDATE devices SET desired = $2 WHERE id = $1', [delta.deviceId, delta.state]);
      await sqs.send(new DeleteMessageCommand({ QueueUrl: QUEUE_URL, ReceiptHandle: msg.ReceiptHandle! }));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));   // retry in place
    }
  }
  // give up silently; message reappears after visibility timeout
}`,
      },
      hints: [
        'With a 30 s visibility timeout and a 40 s gateway call, what happens to each in-flight message? What does that do to gateway load?',
        'With a nightly full sweep and per-device versions, which of the 7M messages carry no new information?',
        'How many concurrent gateway calls does this loop allow? What does Little\'s law say it should be at 40 s latency?',
      ],
      solution: {
        language: 'typescript',
        code: `const MAX_CONCURRENCY = 200;                 // gateway budget: about 50 calls/s at 4 s each
const LIVE_MAX_AGE_MS = 10 * 60_000;
const sem = new Semaphore(MAX_CONCURRENCY);

export async function pollLoop(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    await sem.waitForCapacity(10);          // receive only what we can actually process
    const res = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL, MaxNumberOfMessages: 10, WaitTimeSeconds: 20,
      MessageSystemAttributeNames: ['SentTimestamp', 'ApproximateReceiveCount'],
    }));
    emptyPolls.inc(res.Messages?.length ? 0 : 1);
    for (const msg of res.Messages ?? []) void sem.run(() => handle(msg));
  }
}

async function handle(msg: Message): Promise<void> {
  const sentAt = Number(msg.Attributes!.SentTimestamp);
  if (msg.Attributes!.ApproximateReceiveCount === '1') ageFirstAttempt.observe((Date.now() - sentAt) / 1000);
  const delta = JSON.parse(msg.Body!) as { deviceId: string; version: number; state: unknown };

  // 1. Superseded: the nightly sweep read the device after this delta was produced.
  if (sentAt < (await sweep.lastSnapshotReadAt())) return del(msg, 'superseded_by_sweep');
  // 2. Superseded: a newer version for this device is already applied.
  const { rows } = await db.query('SELECT version FROM devices WHERE id = $1', [delta.deviceId]);
  if (rows[0] && rows[0].version >= delta.version) return del(msg, 'superseded_by_version');
  // 3. Old but still meaningful: sideline so fresh deltas are not stuck behind it.
  if (Date.now() - sentAt > LIVE_MAX_AGE_MS) {
    await sqs.send(new SendMessageCommand({ QueueUrl: BACKLOG_QUEUE_URL, MessageBody: msg.Body! }));
    return del(msg, 'sidelined');
  }

  // 4. Process under a heartbeated lease: no second worker gets this message mid-flight.
  await processWithLease(msg, async (abort) => {
    await gateway.applyDesiredState(delta.deviceId, delta.state, { signal: abort, timeoutMs: 60_000 });
    await db.query(
      'UPDATE devices SET desired = $2, version = $3 WHERE id = $1 AND version < $3',
      [delta.deviceId, delta.state, delta.version],
    );
  });
  // No in-place retry loop: failures return to the queue (with backoff via visibility)
  // and go to a DLQ after maxReceiveCount = 5 (redrive policy), which pages.
}`,
      },
      explanation: `**Fixes, mapped to the Builders' Library backlog guidance:**
- **Heartbeated lease** (\`processWithLease\` extends visibility every 10 s, with a total cap and abort). The starter's 30 s timeout with 40 s gateway calls made every message reappear and run twice in parallel, the "fork bomb" that kept the gateway at 100%.
- **Bounded concurrency by Little's law.** Fire-and-forget allowed unbounded in-flight calls. A semaphore caps gateway concurrency, and the poller receives only when it has capacity, so messages are not held invisible while waiting.
- **Dropping superseded deltas.** State deltas are "latest wins". Anything produced before the last sweep's snapshot read, or with a version ≤ the stored one, is deleted unprocessed. This usually removes most of a backlog that is hours old.
- **Fresh-first.** Messages older than 10 minutes go to a backlog queue drained by a separate, smaller poller, so new deltas meet their latency target during recovery (approximately LIFO).
- **Order safety.** \`WHERE version < $3\` means sidelined or duplicate older deltas can never overwrite newer state.
- **No retry-in-place.** Five in-place attempts held a worker slot and a message lease for minutes. Failures now return to the queue and land in a DLQ with an alarm.
- **Recovery metrics.** Age at first attempt and the empty-poll ratio show whether the system is catching up. Delete reasons (superseded, sidelined, applied) show where the backlog went.`,
      followUps: [
        {
          q: 'How would you tell, an hour into recovery, whether the system will catch up by itself or needs intervention?',
          a: 'Watch the **trend of age at first attempt** on the live queue plus the drain estimate: depth ÷ (processed rate − enqueued rate). If processed minus enqueued is positive and the oldest age is falling, it converges. Track the backlog queue separately with its own ETA. Signs that it will not converge: retries ≥ first attempts, gateway latency still at incident levels while CPU stays pinned (the sustaining loop is still active), and a rising DLQ rate. Then reduce the concurrency cap further or pause the backlog poller until the gateway\'s latency returns to normal.',
        },
        {
          q: 'Some messages are commands ("reboot device") rather than state. Which of your backlog tactics are now illegal for them?',
          a: 'Dropping is illegal: neither the sweep nor a newer version supersedes a command, so a missed reboot is a missed action. Sidelining is still legal but changes the semantics, because a reboot two hours late can be harmful. Give commands an explicit `expiresAt` set by the producer, and if one expires, record it as **expired** and notify the caller rather than silently executing or dropping it. Put commands on a separate queue with higher priority and their own age SLO, so a state-delta backlog never delays them. Dedupe them with an idempotency key, because the heartbeat lease reduces duplicates but at-least-once delivery remains.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'rel-production-judgment-iq-01',
      difficulty: 'hard',
      question:
        'Design review: the checkout team wants "if our primary payment gateway returns errors for 30 seconds, switch all traffic to the secondary gateway". The secondary has never carried more than test traffic. Do you approve it? What would you ask for instead?',
      whatInterviewerLooksFor: [
        'Identifies this as fallback (dormant path) rather than failover',
        'Asks about capacity, rate limits and contracts on the secondary at 100% of traffic',
        'Proposes always-on weighted routing with idempotency across providers',
        'Thinks about the switching trigger itself (flapping, partial failures)',
      ],
      modelAnswer: `**Verdict: not as designed.** A gateway that has only ever carried test traffic is a fallback, so it will be exercised for the first time at full load, mid-incident, on every checkout pod at once.

**What can go wrong at the switch:**
- **Capacity and quotas.** The secondary PSP may rate-limit at, say, 200 TPS on our account while our peak is 1,500 TPS. We would get 429s on the path we switched to for safety.
- **Untested integration.** Rarely used flows (3DS challenge, UPI collect, refunds) break in ways test traffic never covered: expired webhooks secrets, unregistered callback URLs, a missing merchant category.
- **Correctness.** A charge that timed out on A and is retried on B can double-charge unless idempotency spans providers.
- **Trigger behaviour.** "Errors for 30 s" flips the whole fleet together and can flap back and forth.

**What I'd ask for: convert fallback into failover.**
1. Route **continuously**, e.g. 80/20 by weight, so both integrations carry real production traffic every minute and both have SLO dashboards.
2. Negotiate and **load-test** the secondary's limits for 100% of peak (or accept that it can absorb only X% and plan to degrade the rest).
3. Health only **re-weights between live paths**, and is evaluated per pod with hysteresis (e.g. move 10% of weight per 30 s) rather than a fleet-wide switch.
4. **Idempotency:** one order-level payment intent in our DB. Before retrying on another provider, query provider A for the attempt's status; reconcile late webhooks.
5. Kill switch and alarms on the per-provider success rate and on the share of retried payments.

**Trade-off:** we pay the secondary's fees on 20% of volume and maintain two integrations properly, which buys an alternate path that is proven every minute.`,
      followUps: [
        {
          q: 'Finance says the secondary costs 0.4% more per transaction, so they want it at 0% normally. How do you respond?',
          a: 'Quantify both sides. At ₹500 crore/month GMV, 20% on the secondary costs 0.4% × ₹100 crore = ₹40 lakh/month. Compare that with the expected outage cost: an hour of failed checkouts at peak is likely several crore plus churn. A compromise is **5% steady state**, still enough to keep the integration exercised and its alarms meaningful, plus a monthly game day that shifts to 50% for an hour. At 0%, it is a fallback and should be treated as unavailable during incident planning.',
        },
        {
          q: 'Provider A is timing out, not failing fast. What makes the retry on provider B dangerous, and how do you handle it?',
          a: 'A timeout is an **unknown outcome**: A may have captured the money. Retrying on B can then double-charge. Record the attempt with a status of `pending_unknown`. Query A\'s status API (or wait for its webhook) within a bounded window before trying B, or only fail over attempts that failed **before** reaching A (connection refused, 503 at the edge). For any that remain unknown, show the user "processing" and let reconciliation decide. Never auto-refund on a guess.',
        },
        {
          q: 'How would you test that weighted failover actually works before a real outage?',
          a: 'Use production fault injection scoped by cell: on 5% of pods, make the provider-A client return 503 (or add 2 s latency), then verify that weights shift within the expected time, the success rate stays above the SLO, there are no double charges in reconciliation, and alarms fire. Run it during business hours with the PSP\'s knowledge and gradually increase the scope. Also run a **capacity test** on B at the target share, because a failover that works at 5% can still hit B\'s rate limits at 60%.',
        },
      ],
      pitfalls: [
        'Approving because "having a backup is always better than not"',
        'Ignoring rate limits and contractual TPS on the secondary',
        'Retrying a timed-out charge on another provider without idempotency or status checks',
        'A fleet-wide binary switch with no hysteresis',
      ],
    },
    {
      id: 'rel-production-judgment-iq-02',
      difficulty: 'expert',
      question:
        'Our 300 NestJS pods read routing rules and feature flags from a config service at startup and on every cache miss (TTL 60 s). The config service had a 12-minute outage and pods started failing requests and restarting. Redesign how config reaches the pods.',
      whatInterviewerLooksFor: [
        'Removes config service from the request path and from startup criticality',
        'Constant-work full-snapshot pull with last-known-good',
        'Discusses fixed-size payloads, atomic swap, validation, staleness alarms',
        'Considers the cold-start case and blast radius of a bad config',
      ],
      modelAnswer: `**Diagnosis:** config is fetched at request time (TTL miss) and is a hard startup dependency. When the service went down, TTLs expired across all pods within 60 s, and restarted pods could not boot. This is a fallback-shaped dependency with no proven path.

**Redesign: push ahead of need with constant work (the Hyperplane pattern).**
1. **Publisher:** the config service compiles the **full** desired state (routes + flags) into a versioned, signed file, \`config-v{n}.bin\`, and writes it to S3 (versioned bucket) every time it changes, plus a heartbeat rewrite every few minutes so freshness is observable.
2. **Pods:** every 10 s, GET the whole file, verify the signature and schema, check version monotonicity and size sanity, then atomically swap an in-memory reference. **The request path reads memory only.**
3. **Last-known-good:** keep the previous snapshot in memory and also write it to the pod's local disk (\`emptyDir\`). A restarting pod boots from disk if S3 or the publisher is unavailable, so it is statically stable.
4. **Baked-in floor:** the image ships a known-good snapshot from build time as the last resort, and is marked stale, so a cold pod in a total outage still boots.
5. **Observability:** \`config_version\`, \`config_age_seconds\`, refresh failures. Alarm if age exceeds 5 min or if more than one version runs in the fleet for over 2 cycles.

**Why constant work:** the cost per pod is a fixed GET plus parse every 10 s. A burst of 5,000 flag changes costs exactly the same, and a missed cycle heals on the next one. At 300 pods × 1 MB ÷ 10 s = 30 MB/s from S3, that is trivial.

**Bad-config blast radius:** a constant-work pipe also propagates bad config quickly. Gate publishing with validation, canary new versions to one cell first (pods in cell 1 read \`canary/\`), and support pinning to version n−1.`,
      followUps: [
        {
          q: 'A flag flip must reach all pods within 2 seconds for incident kill switches. Does the 10 s cycle break your design?',
          a: 'Add a low-latency **hint** without making it a dependency. The publisher sends a message on Redis pub/sub or a Kafka topic, and pods that receive it fetch the snapshot immediately. Missed hints are covered by the 10 s cycle. For true emergency kill switches, keep a tiny separate snapshot (a few hundred bytes) polled every 1–2 s. Its cost is still constant: 300 pods × 0.5 req/s is 150 GETs/s, roughly $0.0004 × 150 × 86,400 ÷ 1,000 ≈ $5/day.',
        },
        {
          q: 'Why not just use a long TTL cache plus serve-stale-on-error in each pod?',
          a: 'That is still modal. In steady state it fetches on expiry; during an outage it switches to the stale-serving branch, which is rarely exercised (bugs in the stale branch, eviction under memory pressure, restarted pods with an empty cache). Load on the config service also scales with the number of keys missing at once, so an outage that ends produces a thundering herd of refetches. Full-snapshot polling has one code path in every condition, and a restart is covered by the local-disk copy.',
        },
      ],
      pitfalls: [
        'Adding a retry plus a longer TTL and calling it fixed',
        'Keeping config service as a hard readiness or startup dependency',
        'Forgetting validation, so constant work spreads a bad config fleet-wide in 10 s',
      ],
    },
    {
      id: 'rel-production-judgment-iq-03',
      difficulty: 'hard',
      question:
        'War room: the order-notifications SQS queue has 6M messages and the oldest is 95 minutes old after a 45-minute SMS-provider outage. Consumers are healthy again. The VP asks: "When will customers stop getting late messages, and what are you doing in the next 15 minutes?"',
      whatInterviewerLooksFor: [
        'Computes a drain ETA from spare capacity, not from depth alone',
        'Prioritises fresh messages and classifies stale ones (drop vs deliver late)',
        'Checks downstream (SMS provider) limits before scaling',
        'Communicates with a number and a plan',
      ],
      modelAnswer: `**First 5 minutes: get numbers.**
- Arrival rate λ (say 1.5K msgs/s) and current processing rate μ (2.5K/s, limited by the SMS provider's 2.5K TPS contract). Spare = 1K/s, so ETA ≈ 6M ÷ 1K/s = 6,000 s ≈ **100 minutes** under FIFO. During all of that time, *every* customer — including one who ordered a minute ago — gets an SMS ~95+ minutes late.
- Check whether the provider will burst higher. Scaling consumers beyond 2.5K/s only produces 429s and retries.

**Next 10 minutes: change what we process, not just how fast.**
1. **Fresh-first:** deploy (or flag on) a sidelining rule: messages older than 10 min move to \`notifications-backlog\`. The live queue drops to near-zero age within a couple of minutes, so new customers get on-time SMS again. *That is my answer to "when do customers stop getting late messages": in about 5 minutes for new orders.*
2. **Classify the backlog:** "out for delivery" SMS for parcels already delivered, and OTPs older than their 10-minute validity, are worthless or harmful, so drop them with an audited count. "Order confirmed" and refund notices are still useful, so deliver them late or switch them to email/push, which uses a different provider and doesn't compete for SMS TPS.
3. **Drain the remainder with a capped share** (e.g. 20% of the SMS TPS), so the live lane keeps its SLO.

**Communicate:** "New notifications on time within ~5 minutes; ~2.2M still-relevant old messages delivered within ~75 minutes (20% of SMS TPS ≈ 500/s; sooner for those moved to email); ~3.8M obsolete ones suppressed and logged." (Numbers come from the classification counts.)

**Afterwards:** alarm on age at first attempt rather than depth, add a per-message \`expiresAt\`, and add a second SMS provider in always-on rotation.`,
      followUps: [
        {
          q: 'Legal says transactional SMS for refunds must be delivered, even late. Does your sidelining break that?',
          a: 'No, because sidelining reorders and does not drop. Refund messages go to the backlog queue and are drained by a reserved share of capacity (e.g. 20% of TPS) plus email in parallel. The drop rule applies only to message types with an explicit expiry (OTPs, delivery ETAs). Encode that per type in config rather than in an incident hotfix. Track the per-type age SLO, and alarm if any refund message is older than 6 hours or reaches the DLQ.',
        },
        {
          q: 'An engineer proposes simply purging the queue and asking the order service to re-send. Why is that worse?',
          a: 'Purging is irreversible and blind. It drops legally required refund messages along with the obsolete ones, and "re-send" depends on the order service correctly reconstructing which notifications were pending, a code path that has never run, which is the fallback problem again. A re-send also arrives at once and recreates the backlog. Sidelining plus typed expiry is reversible: you can always redrive the backlog queue.',
        },
      ],
      pitfalls: [
        'Quoting depth ÷ consumer rate and ignoring the arrival rate',
        'Scaling consumers past the SMS provider\'s TPS limit',
        'Delivering hour-old OTPs and stale delivery ETAs in FIFO order',
      ],
    },
    {
      id: 'rel-production-judgment-iq-04',
      difficulty: 'hard',
      question:
        'Our Kafka alerting is "consumer lag > 500,000 messages". It paged 40 times last month, mostly at night for harmless batch imports, and missed a real 25-minute delay on a low-volume payments topic. Redesign the alerting.',
      whatInterviewerLooksFor: [
        'Explains why offset lag is the wrong unit (throughput-dependent)',
        'Proposes time lag / age at first attempt per topic SLO',
        'Separates harmless batch backlogs from latency-critical streams',
        'Adds a drain-time or "insurmountable" signal',
      ],
      modelAnswer: `**Why offset lag fails:** 500K messages is 10 seconds of work on a 50K msg/s clickstream topic and *days* of work on a 5 msg/s payments topic. A count threshold is therefore too sensitive on big topics and blind on small ones. Customers experience **time**, not offsets.

**Redesign: alert on age, per topic, against that topic's SLO.**
1. **Time lag:** export \`kafka_consumergroup_group_max_lag_seconds\` (kafka-lag-exporter interpolates produce timestamps from offsets). Alert on payments \`> 60 s for 5 m\`, notifications \`> 5 m\`, analytics \`> 2 h\`.
2. **Age at first attempt from the app:** producers stamp \`produced_at\` in a header. The consumer records \`now − produced_at\` in a histogram **only on the first delivery attempt**, so retries and replays don't pollute it. This is the AWS IoT AgeOfFirstAttempt idea. Alert on p99.
3. **Is it insurmountable?** Compute an ETA, \`lag_messages ÷ (consume_rate − produce_rate)\`, with a separate warning when the ETA exceeds an hour or the denominator is ≤ 0 (we are not catching up at all).
4. **Batch imports:** route them to their own topic and consumer group with a looser SLO, or tag them so the age alert excludes them. The noise came from mixing two workload classes on one alert.
5. **Heartbeat messages** on very quiet topics: a producer emits a synthetic message every 30 s, so "no lag" can't hide "no consumer" (time lag stays at 0 if nothing is produced, and a dead consumer goes unnoticed).

**Result:** pages correspond to customer-visible delay, and a 25-minute delay on payments pages within ~6 minutes.`,
      followUps: [
        {
          q: 'Your consumer group is completely stuck but kafka-lag-exporter shows time lag of only 90 s. How can that be?',
          a: 'Time lag is interpolated from the produce rate. On a quiet topic with only a few messages in the last hour, the estimator can under-read badly, and if nothing new is produced, lag stays flat while the consumer is dead. That is why you need a heartbeat producer (a synthetic message every 30 s) and an alert on **committed offsets not advancing** while the log-end offset grows. App-side "age at first attempt" stops reporting when nothing is consumed, so alert on its **absence** too (`absent_over_time`).',
        },
        {
          q: 'Should the age alert fire on p99 or max?',
          a: 'Max reacts to a single poison message being retried, which is noisy but is exactly what the first-attempt filter removes. Use **p99 of first-attempt age** for paging, because it reflects broad delay. Use **max age of oldest unprocessed** per partition as a ticket-level alert, because it catches a stuck partition (hot key, poison pill) that p99 across 48 partitions would hide. Both should evaluate per partition-group, not averaged across the topic.',
        },
      ],
      pitfalls: [
        'Lowering the message threshold per topic and calling it fixed',
        'Measuring age including retries, so one poison message pages',
        'No signal for a dead consumer on a quiet topic',
      ],
    },
    {
      id: 'rel-production-judgment-iq-05',
      difficulty: 'expert',
      question:
        'You run a multi-tenant webhook-delivery platform: 8,000 merchants, one shared queue, 400 workers. Last week one merchant\'s endpoint started responding in 25 s instead of 200 ms, and every merchant\'s webhooks were delayed by 40 minutes. Redesign the queueing so one tenant can\'t do that again.',
      whatInterviewerLooksFor: [
        'Uses Little\'s law to explain how one slow tenant consumed all workers',
        'Per-tenant concurrency caps / spillover rather than a single FIFO',
        'Shuffle-sharded queue topology with least-full enqueue',
        'Treats the slow tenant\'s backlog as its own problem with its own age SLO',
      ],
      modelAnswer: `**What happened (Little's law):** suppose the slow merchant has 20 deliveries/s. At 25 s each, that needs 20 × 25 = **500 concurrent workers**, which is more than the entire 400-worker fleet. Every worker ended up blocked on one merchant's socket, and the shared FIFO queue held everyone else behind it.

**Redesign, in layers:**
1. **Per-tenant concurrency cap** in the worker (semaphore keyed by merchant, e.g. max 10 in flight, scaled with the merchant's normal volume). The slow merchant now uses at most 10 workers, and its throughput falls to 10 ÷ 25 s = 0.4/s, its own problem.
2. **Spillover:** when a merchant is at its cap, workers move that merchant's excess messages to a **spillover queue** (and delete them from the primary) instead of holding or re-queueing them in place. The primary stays fresh for everyone else.
3. **Shuffle-sharded queues** (the Lambda async pattern): 32 queues, each merchant hashed to 2, enqueue to the less full of the two. A merchant that floods its two queues affects only merchants sharing **both** of them, roughly 1/C(32,2) = 1/496 of merchants.
4. **Timeouts and breakers per endpoint:** a 10 s delivery timeout plus a per-merchant circuit that pauses deliveries and uses exponential retry delays (delay queue) once the failure rate is high.
5. **Metrics per tenant:** age of oldest per merchant (top-K), and an alarm on any single merchant using more than X% of workers.

**Trade-offs:** spillover and shuffle sharding complicate per-merchant ordering (deliver with a sequence number and let merchants dedupe or reorder), and polling 32 queues costs more empty receives (long polling keeps this small).`,
      followUps: [
        {
          q: 'A large merchant legitimately sends 2,000 webhooks/s and its p50 is 300 ms. Doesn\'t a cap of 10 throttle a healthy customer?',
          a: 'Make the cap proportional to the **expected** concurrency: 2,000/s × 0.3 s = 600 in flight, so set its cap to ~1.5× that (900) and give it dedicated workers or a dedicated queue (a "noisy but paying" tier). The goal is not equality. It is that latency degradation in one tenant cannot claim more than its budgeted share. If its endpoint slows to 25 s, the cap holds it to 900 workers and its own backlog, which then needs its own age alarm and customer notification.',
        },
        {
          q: 'How do you choose 32 queues and 2 per merchant?',
          a: 'With 32 queues and 2 per merchant, there are C(32,2) = 496 distinct pairs, so about 8,000 ÷ 496 ≈ 16 merchants share any exact pair. They are the only ones fully exposed to a flooding neighbour, and everyone else always has one clean queue. 64 queues gives 2,016 pairs (≈ 4 merchants each) but doubles polling overhead. Choose the smallest count where full-overlap neighbours are acceptable, and remember that SQS standard queues cost per request, not per queue, so empty long polls dominate the cost.',
        },
      ],
      pitfalls: [
        'Scaling workers to 2,000 (the slow tenant soaks them up too)',
        'One queue per tenant for 8,000 tenants without considering polling cost',
        'Retrying slow deliveries in place, which holds the worker even longer',
      ],
    },
    {
      id: 'rel-production-judgment-iq-06',
      difficulty: 'expert',
      question:
        'A postmortem draft reads: "Root cause: 20-second Redis primary failover. Action item: tune Sentinel timeouts." The outage lasted 3 hours, and Postgres stayed at 100% CPU long after Redis was healthy. Critique the postmortem and tell me what the real root cause and actions are.',
      whatInterviewerLooksFor: [
        'Recognises a metastable failure: trigger vs sustaining effect',
        'Identifies the specific loop (cache fill gated on request success, retries)',
        'Defines hidden capacity and a characteristic metric',
        'Proposes actions that weaken the loop for any future trigger',
      ],
      modelAnswer: `**The tell:** the trigger lasted 20 s and the outage lasted 3 h. When the impact outlives the trigger by 500×, something else is keeping the system down. That is a **metastable failure**, and the root cause is the **sustaining effect**, not the failover.

**Likely sustaining loop:**
1. The failover empties or invalidates the cache, so the hit rate drops from 95% to ~0.
2. 20× the normal miss load hits Postgres, and query latency rises past the 500 ms app timeout.
3. The look-aside code fills Redis **only after a successful DB read**, and the request times out first, so the cache **never refills**.
4. Clients and the gateway retry, adding 2–3× more load, and the GC pressure from piled-up in-flight promises makes pods slower still.
5. Steady state: Postgres at 100% doing work nobody waits for, goodput ≈ 0.

Tuning Sentinel addresses one trigger. A deploy that flushes keys, a cold region failover or a traffic spike would trigger the same loop.

**Real root cause:** the system runs at ~20× its **hidden capacity** (what Postgres can serve with a cold cache), and nothing bounds the amplification.

**Actions:**
- **Decouple cache fill from the request deadline:** a read-through/background fill with a permissive timeout and request coalescing, so the hit rate climbs even when users time out.
- **Retry budget** (≤ 10% of requests) at one layer, and **deadline propagation** so Postgres abandons queries whose caller has gone.
- **Load shedding keyed on DB queueing delay**, using a CoDel-style minimum over a window, and LIFO admission under persistent overload.
- **Characteristic metric:** DB p50 queue wait plus cache hit rate, with an alarm on its safe range.
- **Game day:** flush the cache at 60% of peak in one cell and verify self-recovery without intervention. Repeat at higher load to find hidden capacity.
- Keep the Sentinel tuning, but as a minor item.`,
      followUps: [
        {
          q: 'How did the team eventually recover after 3 hours, and what would have recovered it in 10 minutes?',
          a: 'Probably by accident: traffic fell late in the evening, or someone restarted pods and the gateway rate limits blocked retries, which pushed load below hidden capacity long enough for the cache to warm. A deliberate 10-minute recovery: shed 80–90% of traffic at the edge (serve a lightweight page), disable retries via a flag, warm the hot-key set from a list of the top 1% of keys (a background job at a rate the DB can take), then ramp traffic in 10% steps while watching the hit rate and DB queue wait.',
        },
        {
          q: 'Someone says "just add read replicas so Postgres can handle a cold cache". Evaluate.',
          a: 'It raises hidden capacity, which is the right direction, but check the multiple: a 95% hit rate means a cold cache produces 20× DB load, so you would need roughly 20× the read capacity to be fully stable, which is rarely economical. Replicas added *during* the incident also need warm-up time (buffer cache), and adding them is reconfiguration that briefly reduces capacity. The better approach is to cut amplification (fill decoupling, coalescing, retry budget) and use replicas to move hidden capacity from 5% to, say, 30% of peak.',
        },
      ],
      pitfalls: [
        'Accepting the trigger as root cause',
        'Proposing more retries or longer timeouts, which strengthen the loop',
        'No test that proves self-recovery after a trigger',
      ],
    },
    {
      id: 'rel-production-judgment-iq-07',
      difficulty: 'expert',
      question:
        'How would you find out — before it happens — whether our order platform is sitting in a vulnerable state that a small trigger could tip into a long outage? Assume Node services, Postgres, Redis and Kafka.',
      whatInterviewerLooksFor: [
        'Hidden vs advertised capacity and how to measure each',
        'Inventory of work amplifiers (retries, caches, failover, error paths)',
        'Characteristic metrics and trigger-intensity testing',
        'Safe production experimentation (cells, Kraken-style rebalancing)',
      ],
      modelAnswer: `**1. Inventory the amplifiers.** For every hop, write down the worst-case work multiplier when something fails:
- Retries: attempts per layer multiply (3 attempts at each of 3 layers = 3³ = 27×).
- Caches: a hit rate h means 1 ÷ (1 − h) amplification on loss (95% → 20×).
- Failover: a shard's load moves onto its neighbours.
- Error paths: logging cost per error versus per success (stack traces, sync DNS).
- Consumer leases: timeouts shorter than incident latency produce duplicate processing.

**2. Compute hidden capacity per dependency.** For Postgres: max QPS with the cache cold and the retries that would actually happen. If peak traffic needs 2,000 QPS warm but 40,000 QPS cold, and the DB tops out at 8,000, then hidden capacity is ~20% of peak, so we are **vulnerable for most of the day**.

**3. Pick characteristic metrics.** These are metrics that only go back to normal once the loop is broken: DB queue wait (p50, not p99), cache hit rate, timeout fraction, retry ÷ first-attempt ratio, Kafka rebalance rate, event-loop lag. Record their normal ranges.

**4. Test trigger intensity, safely.** In one cell, or a replica environment whose characteristic metrics match prod, apply triggers at increasing load: flush 10%/50%/100% of the cache, inject a 10 s network pause, kill a broker. The question isn't "does it fail" but **"does it recover without intervention, and how long does that take"**. The highest load at which it self-heals approximates hidden capacity. Facebook's Kraken approach (shifting live traffic to load a slice of prod) gives realistic answers that small-scale tests can't, because loop strength depends on scale.

**5. Act on the gap.** Bound amplifiers (retry budgets, fill decoupling, fast error paths), raise hidden capacity where it is cheap, and alarm when load exceeds hidden capacity × safety factor, so on-call knows when the system is in the vulnerable state.`,
      followUps: [
        {
          q: 'Your test cell recovers from a full cache flush at 100% of its load. Does that prove production is safe?',
          a: 'Not necessarily. The strength of a feedback loop depends on constant factors that vary with scale: connection counts, the number of clients retrying, fan-out, the cross-AZ link and shared DB. A cell that has its own DB at 1/10 of the load has a different ratio of cache-miss traffic to DB capacity than a shared prod DB. Check that the cell\'s characteristic metrics (hit rate, DB queue wait, retry ratio) during the test match what prod would see, and also make sure the load generator does not suffer coordinated omission. It should keep sending at the target rate while responses slow down, as real open-loop users do.',
        },
        {
          q: 'Leadership asks for one number on the dashboard. Which one?',
          a: '**Load ÷ hidden capacity** for the most critical dependency, e.g. "orders DB: 3.2× hidden capacity". Below 1, any trigger self-heals; above 1, the system relies on optimisations staying healthy. It turns an abstract risk into a trend that you can push down by reducing amplification. Pair it with the characteristic metric (DB queue wait) so on-call can see whether a loop is forming right now.',
        },
      ],
      pitfalls: [
        'Equating "we load-tested to 2× peak" with safety (warm caches, no trigger applied)',
        'Only measuring averages, which hide the onset of the loop',
        'Proposing chaos tests in prod without cell-level blast-radius limits',
      ],
    },
    {
      id: 'rel-production-judgment-iq-08',
      difficulty: 'hard',
      question:
        'We want to switch our order events on Kafka from JSON to Protobuf, and in the same release change the values in our Redis session cache to compressed MessagePack. Ten services consume the events. Walk me through a rollout where any step can be rolled back safely.',
      whatInterviewerLooksFor: [
        'Splits each format change into prepare and activate phases',
        'Orders producers and consumers correctly forward and backward',
        'Uses explicit format versions and per-version metrics',
        'Refuses to bundle two one-way changes in one release',
      ],
      modelAnswer: `**Principle:** each change is a potential one-way door. Split each into **Prepare** (every reader understands both formats, writers still write the old one) and **Activate** (writers switch). Never ship both changes, or both phases of one change, in a single deploy.

**Kafka events (JSON → Protobuf):**
1. **Prepare consumers (all 10 services):** deserialize based on a header, \`content-type: application/json | application/x-protobuf; v=2\`. Default to JSON when the header is absent. Emit \`events_decoded_total{format}\`.
2. **Verify 100%:** every consumer deployment in every cluster is on the Prepare build, including batch jobs and the data-lake sink that people forget. Don't trust "deploy succeeded at 90% healthy".
3. **Bake** for a few days so that a rollback of any consumer remains possible without seeing protobuf.
4. **Activate the producer** behind a flag, starting with one partition key range or one cell. If something breaks, flip the flag off. Consumers already handle mixed topics.
5. **Contract:** once retention has passed (7 days) and no JSON is produced, remove JSON decoding in a later release.

**Redis session values (JSON → compressed MessagePack):**
- Same pattern, with a **version byte prefix** on each value. Prepare: read v1 and v2, write v1. Activate: write v2. Rollback after Activate leaves v2 values that the Prepare build reads. Because sessions expire (TTL 24 h), no backfill is needed. Waiting one TTL after Activate means v1 decoding can be removed.

**Ordering rules:** roll forward readers before writers, and roll back writers before readers. **Test it** with an upgrade-downgrade run on a multi-AZ staging fleet using the production deploy configuration: deploy half, deploy all, roll back all, with continuous traffic touching every consumer and the nightly jobs.

**Timeline:** roughly 4 releases over 2–3 weeks instead of one. That is the price of never facing an un-rollbackable deploy at 2 a.m.`,
      followUps: [
        {
          q: 'A team asks: "Our consumer ignores unknown JSON fields — do we still need two phases to add a field?"',
          a: 'Usually not. Adding an **optional** field that old readers ignore is rollback-safe in one step, provided the old readers also don\'t **strip** it when they re-serialize and write it back (for example, a consumer that updates a document and drops unknown attributes). The Builders\' Library recommends that serializers preserve unknown attributes on write for this reason. You still need two phases for renaming or removing a field, changing its type or meaning, or making it required.',
        },
        {
          q: 'Midway through Activate, a downstream team says their replay job reads 30 days of history from S3 with an old library. What changes?',
          a: 'The S3 archive is another reader you missed, and its rollback window is 30 days rather than 7. Pause Activate (flip the flag off; mixed data is fine), add Prepare support to the replay job, or have the archiver convert to the job\'s format on write. Add it to the reader inventory. The lesson is to enumerate readers from **data lineage** (topic ACLs, S3 access logs), not from memory.',
        },
      ],
      pitfalls: [
        'Shipping reader and writer changes in one deploy',
        'Using the build version instead of an explicit format version',
        'Forgetting archives, replay jobs and DLQ redrive tooling as readers',
      ],
    },
    {
      id: 'rel-production-judgment-iq-09',
      difficulty: 'hard',
      question:
        'Design the deployment pipeline for a payments API (about 40 microservices) running in Mumbai and Hyderabad, so that most releases ship with no human watching and a bad change hurts as few customers as possible. What runs automatically, how long do you bake, and what blocks a deploy?',
      whatInterviewerLooksFor: [
        'Staged pre-prod (alpha/beta/gamma) and one-box per prod stage',
        'Region and AZ waves with bake times justified by traffic and error detection',
        'Alarm-driven automatic rollback including request-count anomalies',
        'Deploy blockers, time windows and rollback-safety prerequisites',
      ],
      modelAnswer: `**Stages:**
1. **Build:** unit tests, a signed immutable artifact. Separate pipelines for code, infra (CDK/Terraform), and config/flags, so each change type rolls out and rolls back on its own.
2. **Pre-prod:** alpha (component tests), beta (end-to-end against sandbox PSPs), **gamma** (production-like configuration in both regions), plus a **backward-compat stage** where the new build runs against the current prod API contracts and an upgrade-downgrade test.
3. **Prod wave 1 — Hyderabad (lower traffic):** one-box (one pod, ≤5% of requests via weighted routing) with **pod-scoped** alarms, baking at least 1 h and until ≥ 20K requests have passed. Then AZ by AZ with 1 h bakes. After the wave, a **long bake (~12 h)** covering a full daily cycle, including the night settlement batch.
4. **Prod wave 2 — Mumbai:** the same one-box first, then AZ by AZ with 2 h bakes.

**Automatic rollback triggers:** 5xx rate, p99 latency, payment success rate per PSP, CPU/memory, and **anomaly detection on request-count drops** (a bad build that silently drops traffic doesn't raise errors). One **team-level aggregate alarm** rolls back all of that team's in-flight deployments in the region.

**Blockers:** no new deploy while the aggregate or org-wide sev-2 alarms fire (with an override for fixes), deploy windows Mon–Thu 10:00–16:00 IST, and freezes for sale days, salary-day peaks and month-end settlement.

**Prerequisites that make it hands-off:** every change rollback-safe (prepare/activate for formats; expand/contract for schemas), feature flags for risky behaviour, and rollback that redeploys the previous immutable artifact, so the rollback path runs constantly in pre-prod and never becomes a special mode.

**Cost:** a change takes ~2–3 business days to reach all of prod. Hotfixes use the same pipeline with shorter bakes, never a side door.`,
      followUps: [
        {
          q: 'Why bake 12 hours after the first wave when errors usually show within minutes?',
          a: 'Many defects are **time- or traffic-pattern-dependent**: the nightly settlement batch, token refresh after 8 h, a memory leak that OOMs after 6 h, a cron that runs at 02:00, a peak-hour code path. A 12 h bake covers a full peak plus the night batch in the low-traffic region before the high-traffic region is exposed. Later waves bake less because the failure modes that need a daily cycle have already been tested. The minimum-request rule stops a quiet 3 a.m. hour from counting as a bake.',
        },
        {
          q: 'The one-box shows 0.6% extra 5xx while the region-level rate is unchanged. Roll back?',
          a: 'Yes, automatically. That is the reason for **box-scoped alarms**: the one-box carries ≤5% of traffic, so a 0.6% fault increase on it moves the regional rate by ~0.03%, invisible in aggregate. Compare the box against the rest of the fleet over the same window. If the difference is statistically significant over the minimum request count, roll back and block promotion. Investigate afterwards. Rollback is cheap and well exercised; a wrong promotion is not.',
        },
      ],
      pitfalls: [
        'Fleet-wide canary with only aggregate alarms',
        'Bake measured purely in minutes without a request-count floor',
        'Treating rollback as a manual, rarely-run procedure',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'rel-production-judgment-boe-1',
      question:
        'A payment-events consumer normally handles 6K msgs/s against 4K msgs/s of arrivals. It was down for 40 minutes, including detection time. You can scale consumers to 2× (12K/s), but the ledger Postgres tops out at 9K writes/s. How long until the backlog clears, and what does that tell you?',
      assumptions: [
        'Arrival rate λ = 4,000 msgs/s, steady, producers unthrottled during the outage',
        'Normal consumer capacity μ = 6,000 msgs/s; emergency scale-out to 12,000/s is possible',
        'Downstream Postgres caps effective processing at 9,000 writes/s (1 write per message)',
        'Outage + detection = 40 minutes = 2,400 s',
      ],
      steps: [
        { label: 'Backlog built', calc: '4,000 msgs/s × 2,400 s = 9.6M messages' },
        { label: 'Drain at normal capacity', calc: 'spare = 6,000 − 4,000 = 2,000/s → 9.6M ÷ 2,000 = 4,800 s = 80 min' },
        { label: 'Naive 2× estimate', calc: 'spare = 12,000 − 4,000 = 8,000/s → 9.6M ÷ 8,000 = 1,200 s = 20 min (not achievable)' },
        { label: 'Real ceiling = DB', calc: 'spare = 9,000 − 4,000 = 5,000/s → 9.6M ÷ 5,000 = 1,920 s = 32 min' },
        { label: 'Total customer-visible delay window', calc: '40 min outage + 32 min drain ≈ 72 min of late events under FIFO' },
      ],
      answer:
        'About 32 minutes after recovery, because the ledger DB, not the consumer count, caps the drain. At normal capacity it would take 80 minutes. Scaling consumers beyond about 9K/s only adds DB contention.',
      insight:
        'Recovery capacity is set by the slowest downstream, so plan it explicitly: (outage + detection) × λ ÷ (downstream max − λ). If that number is unacceptable, you need fresh-first processing and per-type expiry, or more DB headroom reserved for recovery. More consumers do not help.',
      followUps: [
        {
          q: 'After recovery, upstream clients that saw errors replay their own events, doubling arrivals to 8K/s for the next hour. What happens to the drain?',
          a: 'Spare capacity collapses to 9,000 − 8,000 = 1,000/s, so the 9.6M backlog needs 9,600 s ≈ 2.7 hours, and during that hour the replays also add duplicates that must be deduped. This is the queue form of a sustaining effect: the recovery traffic slows the recovery. Mitigate with idempotency keys (duplicates become cheap no-ops before the DB write), a per-client replay rate limit, and fresh-first ordering so live payments are not stuck behind replays.',
        },
        {
          q: 'Finance only needs ledger entries within 15 minutes; analytics can wait 6 hours. How do you use that?',
          a: 'Split by SLO. Give the ledger path its own consumer group and reserve DB headroom for it (e.g. 6K of the 9K writes/s). Analytics writes, if they share the DB, are deferred via a delay or backlog topic and drained at the remaining 3K/s once the ledger is caught up. The ledger backlog alone (say 60% of messages) clears in 5.76M ÷ (6,000 − 2,400) = 1,600 s ≈ 27 min, and the lower-priority analytics work catches up off-peak within its 6-hour SLO.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-boe-2',
      question:
        'A catalog API serves 24K QPS with a 95% Redis hit rate in front of a Postgres cluster that stays healthy up to 3K QPS. Estimate the advertised and hidden capacity, what happens if Redis is flushed at peak with one client retry, and what recovery requires.',
      assumptions: [
        'Hit rate 95% when warm; ~0% immediately after a flush',
        'Postgres latency is fine below 3K QPS and degrades sharply above it',
        'Clients retry once on timeout; the app fills Redis only after a successful DB read',
        'Hot working set ≈ 2M keys; warm-up fills can run at up to the DB\'s 3K QPS',
      ],
      steps: [
        { label: 'Warm DB load', calc: '24,000 × (1 − 0.95) = 1,200 QPS (40% of DB capacity)' },
        { label: 'Advertised capacity', calc: '3,000 ÷ 0.05 = 60,000 QPS of user traffic' },
        { label: 'Hidden capacity', calc: 'cold cache: every request hits DB → 3,000 QPS of user traffic' },
        { label: 'Load after flush', calc: '24,000 QPS to DB = 8× capacity; with 1 retry ≈ 48,000 QPS offered = 16×' },
        { label: 'Shed needed to recover', calc: 'keep ≤ 3,000 of 24,000 → shed 1 − 3,000/24,000 = 87.5%' },
        { label: 'Warm-up time at DB max', calc: '2M keys ÷ 3,000 QPS ≈ 667 s ≈ 11 min' },
      ],
      answer:
        'Advertised capacity is ~60K QPS, but hidden capacity is only ~3K QPS, and the site runs at 8× hidden capacity. A flush at peak offers ~48K QPS to a 3K-QPS DB. Because fills only follow successful reads, the cache never refills: a metastable state. Recovery needs ~87.5% shedding (or retries off plus fill decoupling) for ~11 minutes while the hot set warms.',
      insight:
        'A 95% hit rate is a 20× amplification on loss. Either keep load below hidden capacity (expensive), or weaken the loop: fills that continue past request timeouts, request coalescing, retry budgets, and a pre-computed hot-key warm list. The hit rate is the characteristic metric to alarm on.',
      followUps: [
        {
          q: 'Engineering improves the hit rate to 99% and proposes cutting the Postgres cluster in half to save money. What happens to hidden capacity?',
          a: 'Warm DB load drops to 24,000 × 0.01 = 240 QPS, so halving the cluster to 1.5K QPS looks very safe. But hidden capacity also halves, to 1.5K QPS, and the site now runs at 24,000 ÷ 1,500 = 16× hidden capacity instead of 8×. The cache is now a 100× amplifier on loss. This is the "organisational incentive" trap from the metastability paper: an efficiency win that is spent on cutting capacity makes recovery from any cache loss much harder. Keep the cluster, or invest the savings in fill decoupling and warm-up tooling.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-boe-3',
      question:
        'You adopt a constant-work design for load-balancer routing config: 400 nodes each fetch and fully reload a fixed-size 8 MB snapshot from S3 every 5 seconds. Estimate the request cost, the bandwidth and the per-node overhead, and decide whether constant work is affordable here.',
      assumptions: [
        'S3 GET price ≈ $0.0004 per 1,000 requests; same-region S3→EC2 transfer is free',
        '≈ ₹83 per USD',
        'Parsing the 8 MB snapshot takes ~50 ms of CPU per reload',
        'The file is padded to its maximum size, so cost does not depend on how many rules changed',
      ],
      steps: [
        { label: 'GETs per day', calc: '400 nodes × 86,400 s ÷ 5 s = 6,912,000 GETs/day' },
        { label: 'Request cost', calc: '6.912M ÷ 1,000 × $0.0004 ≈ $2.76/day ≈ $83/month ≈ ₹6.9K/month' },
        { label: 'Aggregate bandwidth', calc: '400 × 8 MB ÷ 5 s = 640 MB/s ≈ 5.1 Gbps out of S3' },
        { label: 'Per-node bandwidth', calc: '8 MB ÷ 5 s = 1.6 MB/s ≈ 12.8 Mbps' },
        { label: 'Per-node CPU', calc: '50 ms ÷ 5,000 ms = 1% of one core, plus a 50 ms event-loop stall if parsed on the main thread' },
      ],
      answer:
        'Very affordable in money (~$83/month) and in per-node bandwidth (~13 Mbps). The real costs are the ~5 Gbps aggregate S3 read rate (spread across prefixes, fine for S3) and a 50 ms parse every 5 s, which must run in a worker thread or use a zero-copy binary format to avoid p99 spikes.',
      insight:
        'Constant work is cheap for control-plane propagation compared with the engineering and incident cost of an event-driven workflow. The binding constraints are parse CPU and aggregate bandwidth, so budget the snapshot size up front and keep the format compact.',
      followUps: [
        {
          q: 'The fleet grows to 4,000 nodes and the snapshot to 40 MB. What breaks first, and what do you change without abandoning constant work?',
          a: 'Aggregate read becomes 4,000 × 40 MB ÷ 5 s = 32 GB/s ≈ 256 Gbps, which is excessive, and per-node parsing grows to ~250 ms every 5 s. Fixes that keep the no-modes property: shard the snapshot by cell so each node fetches only its cell\'s fixed-size slice (e.g. 40 cells → 1 MB each); stretch the interval to 15–30 s where the freshness SLO allows; or add an in-region distribution tier (per-AZ caches) that itself fetches at a constant rate. Using ETag 304s would save bandwidth but brings back variable work when everything changes at once.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'rel-production-judgment-mcq-01',
      difficulty: 'expert',
      question:
        'Two data stores can each answer "what is this customer\'s delivery pincode serviceability?". You want the second store to improve availability without becoming a dormant fallback. Which designs achieve that? Select ALL that apply.',
      options: [
        'Size both stores for 100% of traffic and pick one at random for every request, so both are proven continuously',
        'Keep the second store warm but idle, and flip all traffic to it with a kill switch when the primary\'s error rate exceeds 5%',
        'Push the full serviceability table to each pod on a fixed cadence and answer from memory, so the request path needs neither store',
        'Run a quarterly game day that forces traffic onto the second store for an hour',
        'Retry the primary three times with jittered backoff, and only then query the second store',
      ],
      correct: [0, 2],
      explanation:
        'Random selection between two always-live, fully sized paths turns fallback into failover, because neither path is ever exercised for the first time during an incident. Pushing the data ahead of need removes the request-time dependency entirely, which is the IAM-credentials pattern. A kill-switch flip and "retry then query the other store" both leave the second store dormant until the worst moment. A quarterly game day helps, but it still leaves a mode that runs only a few hours a year.',
      followUps: [
        {
          q: 'Random selection doubles the chance that a request hits a store with a subtle data bug. How do you catch divergence?',
          a: 'Shadow-compare a sample: for 1% of requests, query both stores, return the chosen answer, and asynchronously log mismatches by key and field, with an alarm on the mismatch rate. Since both are always live, divergence shows up in hours instead of during an incident. Also make both stores derive from a single source of truth, the same CDC stream, so they cannot drift through independent write paths.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-02',
      difficulty: 'hard',
      question:
        'This config loader runs on every pod. After a 2-minute S3 permissions blip last week, 3 of 120 pods kept routing a decommissioned tenant to an old cluster for 6 days, until they were restarted. What is the design flaw?',
      code: {
        language: 'typescript',
        code: `let applied = 0;                       // last applied change sequence
const routes = new Map<string, string>();

setInterval(async () => {
  try {
    const feed = await s3Json('routing/changes.json'); // last 500 changes, newest last
    for (const c of feed.changes) {
      if (c.seq <= applied) continue;
      if (c.op === 'put') routes.set(c.tenant, c.cluster);
      else routes.delete(c.tenant);
      applied = c.seq;
    }
  } catch { /* try again next tick */ }
}, 5_000);`,
      },
      options: [
        'The catch block swallows the error; logging it would have made the pods recover by themselves',
        'setInterval allows overlapping ticks, so two loops applied changes out of order on those pods',
        'It is edge-triggered: once more than 500 changes pass during the blip, the missed deletes are gone from the feed, and nothing ever reconciles the full state',
        'Map.delete is not atomic in Node, so concurrent requests saw a partially deleted entry',
      ],
      correct: [2],
      explanation:
        'Applying deltas is edge-triggered. If a pod misses changes that have already rotated out of the bounded feed, it stays wrong forever, because no step rebuilds the full state. A constant-work design reloads the complete routing table every tick, so any missed update is healed on the next cycle. Logging is good hygiene, but it does not fix the lost delete. Overlapping ticks are possible but cannot cause permanent divergence when seq is checked. Node is single-threaded, so Map operations are atomic with respect to requests.',
      followUps: [
        {
          q: 'The full routing table is 30 MB. Do you still reload all of it every 5 s?',
          a: 'Keep the property (a full desired state each cycle), but make it cheap. Use a compact binary format, parse it in a worker thread, and shard by cell so each pod fetches only the fixed-size slice it serves. Alternatively, keep deltas for latency but add a slower full reconcile (e.g. every 60 s) that is authoritative. Then deltas are an optimisation and correctness comes from level-triggered reconciliation.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-03',
      difficulty: 'expert',
      question:
        'Route 53 health checkers send aggregators a result set sized for their maximum capacity (e.g. 10,000 entries) even when only 10 checks are configured. During an Availability Zone failure, what is the main benefit of this?',
      options: [
        'Padding makes the result set compress better, which lowers cross-Region bandwidth costs',
        'Network and aggregator work stay identical whether 0 or 10,000 targets flip state, so the incident does not change the system\'s load',
        'Fixed-size payloads let aggregators detect a dead checker by a payload-size mismatch',
        'It lets DNS servers skip evaluating unhealthy answers, which shortens query latency during the incident',
      ],
      correct: [1],
      explanation:
        'Constant work means the incident changes values in a table, not the amount of work: an AZ outage that flips tens of thousands of checks costs the same bytes and CPU as a quiet day. Compression is not the motivation. Dead-checker detection works through missing reports, not payload size. DNS servers deliberately evaluate all candidate answers on every query, even after finding a healthy one, so query cost stays constant rather than getting cheaper.',
      followUps: [
        {
          q: 'Why do aggregators push the table to DNS servers rather than DNS servers pulling it?',
          a: 'There are far more DNS servers than aggregators. With push, the smaller service controls the rate and load, so the DNS fleet cannot accidentally stampede the aggregators (for example, all retrying after a blip). Either direction can be constant work, but push keeps the fan-out decision with the side that has to absorb it.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-04',
      difficulty: 'medium',
      question:
        'An SQS queue for invoice PDFs alarms when ApproximateNumberOfMessagesVisible exceeds 50,000. Customers report invoices arriving 3 hours late, but the alarm never fired: the visible count stayed around 8,000. What is the most likely explanation, and what is the better alarm?',
      options: [
        'Messages are stuck in flight; raising the visibility timeout makes the depth alarm accurate',
        'SQS undercounts visible messages under load; alarm on NumberOfMessagesSent instead',
        'The DLQ is absorbing the late messages; alarm on any DLQ message as the primary SLO signal',
        'Throughput is low, so 8,000 messages represent hours of work; alarm on the age of messages (first-attempt age or ApproximateAgeOfOldestMessage)',
      ],
      correct: [3],
      explanation:
        'Depth means nothing without throughput. At ~0.75 msgs/s, 8,000 messages is about 3 hours of backlog. Message age measures the customer-visible delay directly. In-flight messages can hide depth, but raising the visibility timeout would not turn depth into a latency metric. SQS approximations are not off by hours. DLQ alarms are worthwhile, but they are a lagging signal and catch only messages that failed repeatedly, not slow ones.',
      followUps: [
        {
          q: 'Why measure age only on the first receive attempt?',
          a: 'Retried messages are old by definition, and a single poison message being redelivered every 30 s would keep max age high and page constantly. Filtering to `ApproximateReceiveCount = 1` (the AWS IoT AgeOfFirstAttempt idea) shows whether *new* work is waiting, which is the early signal of a system-wide backlog. Track retries separately with the DLQ and receive-count metrics.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-05',
      difficulty: 'expert',
      question:
        'This SQS handler sidelines old messages to a backlog queue so fresh telemetry is processed first. Which problems does it have? Select ALL that apply.',
      code: {
        language: 'typescript',
        code: `async function handle(msg: Message) {
  const age = Date.now() - Number(msg.Attributes!.SentTimestamp);
  if (age > 5 * 60_000) {
    await sqs.send(new DeleteMessageCommand({ QueueUrl: LIVE, ReceiptHandle: msg.ReceiptHandle! }));
    await sqs.send(new SendMessageCommand({ QueueUrl: BACKLOG, MessageBody: msg.Body! }));
    return;
  }
  const e = JSON.parse(msg.Body!);
  await db.query('UPDATE sensors SET reading = $2 WHERE id = $1', [e.sensorId, e.reading]);
  await sqs.send(new DeleteMessageCommand({ QueueUrl: LIVE, ReceiptHandle: msg.ReceiptHandle! }));
}
// backlog poller runs only when the live queue is empty`,
      },
      options: [
        'A crash between the delete and the send loses the message, because it is deleted before it is safely in the backlog queue',
        'SentTimestamp is reset when a message is received, so age is always close to zero',
        'A sidelined old reading can be applied after a newer one and overwrite it, because the UPDATE has no version guard',
        'The backlog can starve forever if the live queue is never completely empty',
        'Moving messages between queues breaks SQS at-least-once delivery for the live queue',
      ],
      correct: [0, 2, 3],
      explanation:
        'The code deletes before sending, so a crash or throttle on SendMessage loses data. Always send first, then delete, and accept a possible duplicate. Sidelining reorders messages, so an old reading drained later overwrites fresher state unless the write checks a version or timestamp. Draining the backlog only when the live queue is empty can starve it indefinitely, so reserve a small share of workers for it. SentTimestamp is set at enqueue and does not change on receive. The live queue keeps its delivery semantics, because only the moved copy is a new message.',
      followUps: [
        {
          q: 'Sensor readings are "latest wins". Is there an even cheaper fix than a version guard for the sidelined messages?',
          a: 'Yes: drop sidelined readings that are superseded. If the sensors table stores `reading_at`, a sidelined message older than the stored `reading_at` carries no information and can be deleted without processing. Many state backlogs shrink by 80–95% this way. With a periodic full sweep, anything produced before the sweep\'s snapshot time can be dropped too. Keep counters of dropped vs applied messages so the behaviour is auditable.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-06',
      difficulty: 'hard',
      question:
        'An inventory-sync queue carries per-SKU stock deltas. A full anti-entropy sweep starts at 02:00, reads every SKU\'s stock from the warehouse system as of 02:05 (its snapshot point), and finishes writing at 02:40. At 03:00 the queue holds a backlog of deltas. Which deltas can you safely drop without processing them?',
      options: [
        'Deltas produced before 02:40, because the sweep completed then',
        'Any delta older than 15 minutes, since stock data goes stale quickly',
        'Deltas produced before 02:05, because the sweep\'s snapshot already reflects them',
        'None: deltas are commands and must always be applied in order',
      ],
      correct: [2],
      explanation:
        'A sweep supersedes only changes that its snapshot read included, and that means changes produced before the 02:05 read point. Deltas produced between 02:05 and 02:40 may not be reflected in what the sweep wrote, so dropping them would lose real updates. An arbitrary age TTL drops information that nothing else has captured. Stock deltas expressed as resulting state are not commands, and with a snapshot point they can be safely superseded. Absolute increment deltas would need the sweep to be the authoritative final state.',
      followUps: [
        {
          q: 'The deltas are increments ("+3", "−1"), not absolute values. Does dropping still work?',
          a: 'Only if the sweep writes **absolute** values that are authoritative as of its snapshot point and consumers then apply only increments produced after that point. Otherwise, dropping an increment changes the total. The safer design is to turn increments into absolute state at the source (e.g. "stock = 42 as of version 913") so that "latest wins" holds and both dropping and reordering become safe.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-07',
      difficulty: 'expert',
      question:
        'This worker processes SQS messages with a 30 s visibility timeout. Normal processing takes ~5 s. During a backlog the downstream slows to ~40 s per message. What happens next?',
      code: {
        language: 'typescript',
        code: `for (;;) {
  const { Messages = [] } = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: Q, MaxNumberOfMessages: 10, WaitTimeSeconds: 20,
  }));
  await Promise.all(Messages.map(async (m) => {
    await downstream.process(JSON.parse(m.Body!));     // ~40 s under load
    await sqs.send(new DeleteMessageCommand({ QueueUrl: Q, ReceiptHandle: m.ReceiptHandle! }));
  }));
}`,
      },
      options: [
        'The DeleteMessage calls fail with an invalid receipt handle, so the messages go straight to the DLQ and are lost from the main flow',
        'Messages become visible again at 30 s, other workers start duplicate processing, downstream load rises further and latency grows: a self-reinforcing loop',
        'SQS extends the visibility timeout automatically while the original consumer\'s connection is open',
        'Throughput halves but correctness is unaffected, since each worker waits for Promise.all before receiving more',
      ],
      correct: [1],
      explanation:
        'Once processing outlives the lease, each message is picked up again while the first attempt is still running. The duplicates double the load on a downstream that is already slow, which pushes latency further past the timeout. This is the "fork bomb" the Builders\' Library warns about, and a sustaining loop. Deleting with an old receipt handle after re-receipt may or may not succeed, and in any case it does not route to the DLQ immediately (that happens after maxReceiveCount). SQS does not auto-extend visibility. The correctness claim misses the duplicate side effects.',
      followUps: [
        {
          q: 'You add a heartbeat that extends visibility every 10 s. What else must the heartbeat code do to be safe?',
          a: 'It needs a **hard cap** on total lease time (so a hung call doesn\'t hold a message forever) and **cancellation**: if extending visibility fails (the lease is lost, or the receipt handle expired), abort the in-progress work via an AbortSignal, because another worker may already own the message. Side effects still need idempotency keys, because at-least-once delivery remains. Bound concurrency too, or the heartbeat simply keeps more slow work alive.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-08',
      difficulty: 'hard',
      question:
        'An async-invocation service uses 16 queues. Each customer is hashed to 2 of them, and on enqueue the message goes to the less-full of the customer\'s two queues. Customer X suddenly floods its traffic. Which statements are true? Select ALL that apply.',
      options: [
        'A customer that shares exactly one queue with X keeps flowing, because its enqueues shift to its other, less-full queue',
        'Only customers mapped to the same pair of queues as X, about 1 in C(16,2) = 120 pairs, are fully exposed',
        'X\'s per-customer ordering is preserved, because each customer\'s messages always go to the same queue',
        'Consumers can stop polling X\'s two queues, since X is the only customer on them',
      ],
      correct: [0, 1],
      explanation:
        'Least-full selection steers neighbours that share one queue with X onto their other queue, so they barely notice. Only customers whose pair is identical to X\'s have no clean queue, which is 1 of 120 possible pairs. X\'s messages are split across two queues, so ordering is not preserved. Other customers share X\'s queues too, so consumers must keep polling them, with per-customer concurrency caps there.',
      followUps: [
        {
          q: 'How would you also limit the damage to customers who share both queues with X?',
          a: 'Add consumer-side **per-customer throttling with spillover**: when X exceeds its configured rate, workers move X\'s excess to a spillover queue and delete it from the shared queue, so X\'s backlog stops occupying the head of the queue that its neighbours depend on. Combine that with per-customer concurrency caps in the workers and an age alarm on the spillover queue. Raising the queue count to 32 (496 pairs) also shrinks the fully exposed group roughly 4×.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-09',
      difficulty: 'expert',
      question:
        'A 15-second network partition between the app tier and Postgres ended 20 minutes ago. Postgres is still at 100% CPU, every app request times out at 1 s and is retried once, and goodput is ~0, even though current traffic is a level the system handled happily yesterday. Which action will most quickly restore service?',
      options: [
        'Fail over Postgres to its standby, because the primary must have been damaged by the partition',
        'Raise the app request timeout from 1 s to 10 s so that slow queries can finish',
        'Roll back the network change that caused the partition, so the trigger cannot recur',
        'Disable client retries and shed load at the edge until DB latency normalises, then ramp traffic back gradually',
      ],
      correct: [3],
      explanation:
        'This is a metastable state: the trigger is gone, but retries keep the offered load at about 2× what the DB can handle, so every query misses its deadline. Recovery requires pushing load below hidden capacity or breaking the loop by disabling retries. A failover moves the same overload to a cold standby. A 10 s timeout increases in-flight work and memory without reducing the offered load. Rolling back the trigger does nothing for a loop that is already self-sustaining.',
      followUps: [
        {
          q: 'After recovery, what would you change so that the next partition cannot cause the same 20-minute state?',
          a: 'Weaken the loop permanently. Add a **retry budget** (retries ≤ 10% of requests, enforced per client) so retries cannot double the load. Propagate **deadlines** so that Postgres cancels queries whose callers have gone (`statement_timeout` set from the remaining budget). Add **admission control** keyed on DB queue wait, shedding early with a 503. Then run a game day that applies a 15 s partition at peak load and confirm the system recovers without intervention.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-10',
      difficulty: 'expert',
      question:
        'A search API sits behind a look-aside cache with a 90% hit rate. The backing Elasticsearch cluster handles 400 QPS before latency explodes. The API currently serves 2,500 QPS. Which statement best describes the system?',
      options: [
        'It is safe with ~37% headroom, because advertised capacity is 4,000 QPS and load is 2,500 QPS',
        'It is safe as long as the cache has replicas, because cache loss is then impossible',
        'It runs in a vulnerable state: hidden capacity is about 400 QPS, so losing the cache at 2,500 QPS can trap it in an overload that persists after the cache comes back',
        'It is already in a metastable state, because the load exceeds the backend\'s capacity',
      ],
      correct: [2],
      explanation:
        'With a 90% hit rate, advertised capacity is 400 ÷ 0.1 = 4,000 QPS, but hidden capacity, the load survivable with a cold cache, is just 400 QPS. At 2,500 QPS the system is healthy but vulnerable, because a cache flush sends 2,500 QPS to a 400-QPS backend. "Safe with headroom" uses the advertised number. Replicas reduce some triggers but not deploys that flush keys or bad invalidations. The system is not metastable yet, because goodput is fine until a trigger occurs.',
      followUps: [
        {
          q: 'Name two changes that raise the safe load without adding Elasticsearch nodes.',
          a: 'First, decouple cache fills from request deadlines (read-through fills with a permissive timeout plus request coalescing), so that even when users time out, each hot key is fetched once and the hit rate recovers instead of staying at zero. Second, keep a **warm list** of the top keys, pre-filled by a rate-limited job after any flush or deploy, and serve stale results on miss for a short window. Both reduce the amplification on loss, which is what defines hidden capacity.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-11',
      difficulty: 'hard',
      question:
        'During a cache-loss incident, this code keeps the hit rate near 0% for an hour even after load drops somewhat. Why, and what is the minimal fix?',
      code: {
        language: 'typescript',
        code: `async function getProfile(id: string, signal: AbortSignal) {
  const hit = await redis.get('p:' + id);
  if (hit) return JSON.parse(hit);
  // Request deadline is 300 ms; abort cancels the DB query when the client gives up
  const row = await db.query({ text: 'SELECT * FROM profiles WHERE id = $1', values: [id], signal });
  await redis.set('p:' + id, JSON.stringify(row), 'EX', 600);
  return row;
}`,
      },
      options: [
        'The 600 s TTL is too short; raising it to 24 h makes the hit rate recover faster',
        'The cache is filled only when the DB answers within the 300 ms request deadline; let fills run in a coalesced background task with a longer timeout, independent of the caller',
        'Redis GET is blocking on the event loop; switching to pipelining fixes the hit rate',
        'The abort signal leaks DB connections; removing it from the query is sufficient',
      ],
      correct: [1],
      explanation:
        'When the DB is slow, every query exceeds 300 ms, the abort cancels it, and the SET never runs, so the cache cannot refill. That is the look-aside sustaining loop from the metastability paper. Decoupling the fill from the request (one background fetch per key with a permissive timeout) lets the hit rate climb even while users are timing out. A longer TTL does not help keys that were never filled. Redis calls are non-blocking. Simply removing the abort lets every timed-out request run a duplicate DB query, which adds load without coalescing.',
      followUps: [
        {
          q: 'Your background fill coalesces per key. What still needs to be bounded?',
          a: 'The **total** concurrency of fills against the DB. During the incident, millions of distinct keys miss, so per-key coalescing alone still allows unbounded parallel queries. Put fills behind a global semaphore sized below DB capacity (e.g. 50 concurrent), prioritise hot keys (from a warm list or a request-frequency sketch), and drop fill requests when the fill queue is full rather than queueing them indefinitely.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-12',
      difficulty: 'expert',
      question:
        'You want a "characteristic metric" for a retry-driven metastable failure in your order service, meaning a metric the trigger pushes out of range that returns to normal only once the feedback loop is broken. Which are good candidates? Select ALL that apply.',
      options: [
        'Number of deployments in the last 24 hours',
        'Minimum queueing delay in the DB connection pool over a sliding 5 s window',
        'Average CPU of the stateless API pods',
        'Fraction of client requests that time out',
        'Ratio of retry attempts to first attempts arriving at the service',
      ],
      correct: [1, 3, 4],
      explanation:
        'Minimum queueing delay (the CoDel idea) separates persistent overload from bursts. The timeout fraction and the retry-to-first-attempt ratio directly track the strength of the loop and stay elevated until it breaks. Deployment count is a possible trigger, not the state of the loop. API pod CPU can look normal, or even low, while pods mostly wait on a saturated DB, so it is a poor indicator of goodput.',
      followUps: [
        {
          q: 'Why the minimum, rather than the p99, of queueing delay over the window?',
          a: 'If the queue fully drained at any point in the window, the minimum is near zero, which indicates a manageable burst. If even the luckiest request waited longer than the target for the whole window, the queue never emptied, which is persistent overload. A p99 rises in both cases, so it cannot tell a spike from a standing queue. That distinction is what should trigger policy changes such as LIFO or shedding.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-13',
      difficulty: 'hard',
      question:
        'You are switching order events on Kafka from uncompressed JSON to zstd-compressed Protobuf. Twelve consumer services and one archiver read the topic. Which rollout is rollback-safe at every step?',
      options: [
        'Ship the producer and all consumers in one coordinated release, using a canary on 10% of pods',
        'Have the producer write Protobuf to a new topic and point consumers at it one by one, deleting the old topic after the last switch',
        'Upgrade the producer first so new data exists early, then upgrade consumers quickly in the same maintenance window',
        'Ship decoders for both formats to all readers while the producer keeps writing JSON; verify 100% rollout and bake for days; then flag the producer to Protobuf; remove JSON decoding much later',
      ],
      correct: [3],
      explanation:
        'This is prepare and activate: every reader can handle both formats before any writer emits the new one, and rolling back the writer leaves mixed data that the prepared readers handle. A single coordinated release creates a mixed fleet in which old consumers receive data they cannot decode, and rolling back strands the Protobuf already written. A new topic can work, but deleting the old one and switching consumers one at a time loses ordering and has no clean rollback for consumers that already switched. Producer-first is the classic one-way door.',
      followUps: [
        {
          q: 'How do you know it is safe to start the activate phase?',
          a: 'Metrics, not deploy logs. Every reader emits `events_decoded_total{format}` and reports its build version, and you confirm that 100% of consumer instances, including batch jobs, the archiver and DLQ redrive tools, run the prepare build. Deploy tools that pass at a minimum-healthy-hosts threshold can hide stragglers. Then wait for the bake period, so that rolling back a reader would still land on a build that understands both formats.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-14',
      difficulty: 'expert',
      question:
        'A release changes the peer heartbeat constant shown below from 5,000 to 10,000. Halfway through the rolling deploy, connection-reset alarms fire across the fleet. Why, and what is the rollback-safe version of the change?',
      code: {
        language: 'typescript',
        code: `const HEARTBEAT_MS = 5_000;                      // release N+1 sets 10_000

setInterval(() => peer.send({ type: 'hb' }), HEARTBEAT_MS);

peer.on('message', () => { lastSeen = Date.now(); });
setInterval(() => {
  if (Date.now() - lastSeen > HEARTBEAT_MS * 1.5) peer.close('heartbeat timeout');
}, 1_000);`,
      },
      options: [
        'New receivers now wait 15 s, so they hold dead connections too long; lower the multiplier to 1.1 in the same release',
        'setInterval drifts under event-loop load; switch to a recursive setTimeout and redeploy in one step',
        'Old receivers time out after 7.5 s but new senders beat every 10 s; first release a receive timeout that tolerates 10 s beats while still sending every 5 s, then release the change to send every 10 s',
        'Peers on different versions negotiate different intervals; add a version handshake and deploy everything at once',
      ],
      correct: [2],
      explanation:
        'One constant controls both what a node sends and what it tolerates. In a mixed fleet, old nodes expect a beat within 7.5 s while new nodes send every 10 s, so the old nodes close healthy connections. The fix is two-phase: prepare (a timeout of at least 15 s, still sending every 5 s), bake, then activate (send every 10 s). Rolling back either step stays compatible. The other options change unrelated details, or deploy atomically, which a rolling distributed fleet cannot do.',
      followUps: [
        {
          q: 'How would an upgrade-downgrade test have caught this before production?',
          a: 'Run a multi-node, multi-AZ test fleet with the production rolling-deploy configuration. Deploy the new build to about half the nodes and keep traffic and peer connections active, so mixed-version pairs exist, and connection resets would appear immediately. Then complete the deploy and roll back fully. A single-node environment, or a deploy-all-at-once configuration, never produces an old-new pair, which is why those setups hide protocol bugs like this.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-15',
      difficulty: 'hard',
      question:
        'Your team wants an upgrade-downgrade test that would actually catch rollback-safety bugs before production. Which practices belong in it? Select ALL that apply.',
      options: [
        'A single-instance environment that deploys everything at once, so test results are deterministic',
        'A multi-server, multi-AZ test environment, so old and new versions run side by side',
        'The same deployment configuration and service ordering as production, including batch sizes and health thresholds',
        'Only roll-forward testing, since rollback just redeploys a previously tested artifact',
        'Each stage runs long enough that every API, background workflow and batch job executes at least once',
      ],
      correct: [1, 2, 4],
      explanation:
        'Rollback bugs live in mixed-version operation and in data written by the new version, so the test needs a mixed fleet, production deploy behaviour, and enough time for every reader and writer to run, including nightly jobs. The Builders\' Library describes cases where a single-server environment and a deploy-all-at-once configuration each hid real problems. The old artifact was tested against old data, not against data the new version wrote, so roll-forward-only testing misses exactly the bugs that matter.',
      followUps: [
        {
          q: 'What are the three stages of the test, and what counts as a pass?',
          a: 'Stage 1: deploy the new version to about half the fleet, which proves coexistence. Stage 2: complete the deployment. Stage 3: roll back until every server runs the old version again. Synthetic traffic runs throughout, creating and reading records in quick succession across all APIs. The test passes only if no errors or unexpected behaviour appear at any stage, especially reads of new-format data by old code after the rollback.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-16',
      difficulty: 'medium',
      question:
        'In the first production wave, the one-box (≈5% of a region\'s requests) shows 0.8% more 5xx errors than the rest of the fleet over 40 minutes, and the region-wide error rate is unchanged. The bake period is 1 hour. What should the pipeline do?',
      options: [
        'Finish the 1-hour bake, because the region-wide error rate has not moved',
        'Roll back the one-box automatically and block promotion, based on the box-scoped alarm',
        'Promote, because 0.8% is below the 1% regional rollback threshold',
        'Page on-call to decide manually, since automated rollback should only follow region-level alarms',
      ],
      correct: [1],
      explanation:
        'A one-box carries a small share of traffic, so its regression is diluted roughly 20× in regional metrics. That is why box-scoped alarms exist, and why a significant regression on the box alone triggers rollback without waiting for the bake to finish. Applying regional thresholds to a box comparison misreads what the box measures. Manual decisions add delay to a cheap, well-exercised rollback.',
      followUps: [
        {
          q: 'The one-box serves only 300 requests in its first hour at night. Should it be promoted after the bake?',
          a: 'No. Time alone is not a bake. With 300 requests, a 1% regression means about 3 extra errors, which is statistically invisible. Require a minimum request count (e.g. 20K) as well as the time, or schedule deploys in windows with meaningful traffic. The Amazon pipelines pair minimum bake times with request-count minimums for exactly this reason.',
        },
      ],
    },
    {
      id: 'rel-production-judgment-mcq-17',
      difficulty: 'medium',
      question:
        'Your platform team wants to apply "constant work" everywhere. For which component is constant work the wrong choice?',
      options: [
        'Propagation of load-balancer target health to every proxy',
        'Distribution of routing and feature-flag config to every pod',
        'Evaluation of all candidate DNS answers against an in-memory health table on each query',
        'A 200-pod web tier whose traffic falls by half overnight',
      ],
      correct: [3],
      explanation:
        'Constant work fits small, critical propagation and evaluation work, where the waste is negligible and the absence of modes is valuable. For a large, expensive serving fleet, running peak capacity all night wastes real money, and elastic scaling also keeps the scaling path exercised every day. The other three options are close analogues of the Route 53 and Hyperplane designs.',
      followUps: [
        {
          q: 'Does elastic scaling of the web tier reintroduce modal behaviour you should worry about?',
          a: 'Somewhat, but it is exercised daily: the fleet scales up and down every 24 h, so the path is not dormant. The risk is in rare extremes, such as scaling from minimum to maximum during an incident while new pods have cold caches and connections. Keep a floor (static stability: enough capacity to lose one AZ without scaling), pre-warm new pods before they become ready, and load-test the scale-out rate itself.',
        },
      ],
    },
  ],
};

export default topic;
