import type { Topic } from '../../types';

const topic: Topic = {
  id: 'misc-ops',
  phase: 'miscellaneous',
  order: 7,
  title: 'Microservices, Observability, SLOs, Releases & Disaster Recovery',
  subtitle:
    'Question bank: service boundaries, telemetry that works during a disaster, percentile maths, SLI/SLO/SLA contracts, error-budget policy and burn-rate alerts, canaries, feature flags, Multi-AZ, multi-region and DR drills. New angles only, no repeats of the deep-dive topics.',
  estimatedMinutes: 95,
  sources: [
    'Google — Site Reliability Engineering, Ch 4 Service Level Objectives',
    'Google — The Site Reliability Workbook, Ch 2 Implementing SLOs, Ch 5 Alerting on SLOs, Ch 16 Canarying Releases',
    'Gil Tene — "How NOT to Measure Latency" (coordinated omission)',
    'Netflix & Google — Kayenta automated canary analysis (Spinnaker)',
    'AWS — Disaster Recovery of Workloads on AWS (whitepaper) and Well-Architected Reliability Pillar',
    'AWS — Post-event summary: Amazon DynamoDB service disruption in us-east-1 (Oct 19–20, 2025)',
    'AWS — Creating Disaster Recovery Mechanisms Using Amazon Route 53 (data plane vs control plane)',
    'Prime Video Tech blog — Scaling the audio/video monitoring service and reducing costs by 90% (2023)',
    'kore1.com — SRE Interview Questions 2026: What Gets Asked',
    'algoroq.io — Disaster Recovery Interview Questions for Senior Engineers (2026)',
    'LeetCode Discuss — "Design feature flag system" interview threads',
    'dev.to / last9 — averaged percentiles and histogram buckets',
    'FlagShark & Octopus Deploy — feature flag lifecycle and kill-switch rot (2025)',
    'AWS pricing references — inter-AZ data transfer $0.01/GB each direction',
  ],
  tags: [
    'microservices',
    'observability',
    'percentiles',
    'p99',
    'slo',
    'sla',
    'error-budget',
    'burn-rate',
    'canary',
    'feature-flags',
    'multi-az',
    'multi-region',
    'disaster-recovery',
    'question-bank',
  ],
  cheatSheet: [
    'Microservices buy independent deploy and team autonomy; they cost network hops, partial failure and distributed data. Split along ownership and change cadence, and merge back services that always deploy together.',
    'Observability = asking new questions without shipping code. High-cardinality context (user_id, tenant_id, order_id) belongs on spans and logs, never on metric labels.',
    'Never average percentiles (across pods or across minutes). Sum histogram buckets by le, or merge HDR/t-digest sketches. Max of per-pod p99s is only an upper bound on fleet p99.',
    'Tail math: P(at least one slow call) = 1 − 0.99^N. A user with 100 page views has a 63% chance of seeing something worse than p99.',
    'Coordinated omission: a closed-loop load tester waits on slow responses and stops sending, so it under-samples exactly the bad moments. Use open-loop, constant-arrival-rate load.',
    'SLI = good/valid events measured close to the user; SLO = internal target; SLA = contract with credits, always looser than the SLO. 99.9% of 30 days = 43.2 min; of 28 days = 40.3 min.',
    'Burn rate = observed error ratio ÷ (1 − SLO). Page on 14.4× over 1h AND 5m (2% of a 30-day budget), page on 6× over 6h AND 30m (5%), ticket on 1× over 3d (10%).',
    'Error-budget policy is agreed before the incident: what freezes, who can override, which outages count. A budget nobody enforces is just a dashboard.',
    'Canary: compare canary with a fresh baseline of the same size, not with the old fleet; you need enough requests to see the regression (errors at 0.1% need thousands of requests), and you must fail closed when data is missing.',
    'Feature flags separate deploy from release. Bucket with hash(flagKey + userId), evaluate locally from a cached ruleset, give every flag an owner and expiry, and exercise kill-switch fallbacks.',
    'Multi-AZ survives a datacentre loss inside a region (quorum across 3 AZs, zonal NAT, zonal volumes), but not a regional control-plane, DNS or bad-deploy failure. Cross-AZ traffic costs $0.01/GB each way.',
    'DR = RPO (data loss) + RTO (downtime). Replication copies corruption and ransomware too, so you need immutable, versioned, cross-account backups plus PITR. A backup you have never restored does not count.',
  ],
  sections: [
    {
      heading: 'Microservices — boundaries, costs, and when to merge back',
      body: `**What:** independently deployable services, each owning its data and one business capability. **Why:** so teams can ship and scale independently.

**Mechanism:** each boundary replaces an in-process call (~100 ns) with a network call (~0.5–2 ms inside a zone, with serialisation, retries and partial failure). Data joins turn into API composition or events, and transactions turn into sagas. The payoff only arrives when the boundary matches **ownership and change cadence**: services A and B get the benefit only if they really change and deploy on different schedules.

**How to judge a boundary:**
- *Good:* one team, one data store, few synchronous callers, releases on its own.
- *Bad:* two services always deployed together, chatty call patterns (N calls per request), a shared table, or a "shared model" library everyone must bump.

**The #1 interview trap:** treating microservices as a scaling technique. A monolith scales horizontally just fine; microservices mainly scale **organisations**. The mature answer includes the reverse move: merge services that are really one bounded context (as Prime Video did in 2023 when it moved a monitoring pipeline into one process and cut cost by about 90%).`,
      keyPoints: [
        'Split by ownership and change cadence, not by noun (UserService, OrderService…).',
        'Every boundary adds latency, failure modes and data duplication. Count them.',
        'Merging services back is a legitimate, sometimes overdue, refactor.',
      ],
    },
    {
      heading: 'Observability — context, cardinality, and surviving the disaster',
      body: `**What:** being able to explain *any* behaviour of the system from its telemetry (metrics, logs, traces, profiles) without shipping new code. Monitoring answers questions you knew to ask in advance; observability also answers new ones.

**Mechanism:** metrics are cheap, pre-aggregated and alertable, but their cost grows with label cardinality. Traces and wide structured events can carry **high-cardinality context** (user_id, tenant, cart size, feature-flag variant) because you sample them and never aggregate them into time series. Exemplars link a metric bucket to a trace_id, so you can go from "p99 is up" to "this request, this tenant, this flag".

**What to add beyond auto-instrumentation:** business attributes (tenant tier, payment method, flag variant), spans around in-process waits (pool acquire, lock wait, queue time), and the decision points (cache hit or miss, retry count).

**The #1 trap:** building the observability stack in the same region, cluster and account it watches. When us-east-1 is down, your dashboards and paging go down with it. The meta-monitoring (watching the watchers) and alerting paths must live somewhere else.`,
      code: [
        {
          language: 'typescript',
          title: 'Put high-cardinality context on the span, not on the metric',
          code: `import { trace } from '@opentelemetry/api';
import { Histogram } from 'prom-client';

const checkoutLatency = new Histogram({
  name: 'checkout_duration_seconds',
  help: 'Checkout latency',
  labelNames: ['tenant_tier', 'status_class'] as const, // bounded: ~3 x 5 values
  buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
});

export function annotateCheckout(ctx: { tenantId: string; tier: string; flagVariant: string; items: number }) {
  const span = trace.getActiveSpan();
  // Unbounded values are fine here: spans are sampled, never turned into series
  span?.setAttributes({
    'app.tenant_id': ctx.tenantId,
    'app.flag.new_pricing': ctx.flagVariant,
    'app.cart.items': ctx.items,
  });
  return checkoutLatency.startTimer({ tenant_tier: ctx.tier });
}`,
        },
      ],
    },
    {
      heading: 'P95/P99 — percentiles, tail latency, and aggregation pitfalls',
      body: `**What:** p99 = the latency that 99% of requests beat. The mean hides the tail; the tail is what heavy users and fan-out requests actually experience.

**Mechanism and maths:**
- **Fan-out and sessions amplify the tail:** P(at least one of N calls exceeds p99) = 1 − 0.99^N → 18% for N=20 and 63% for N=100. The "rare" p99 becomes the common experience.
- **Percentiles do not compose:** the p99 of a fleet is *not* the average of per-pod p99s, and the hourly p99 is *not* the average of per-minute p99s. Merge the **distributions** (sum histogram buckets by le, or merge HDR histograms or t-digests), then compute the quantile. Per-pod p99s only bound the answer: fleet p99 ≤ max(pod p99).
- **Bucket resolution:** histogram_quantile interpolates linearly inside a bucket, so put bucket edges at your SLO thresholds.
- **Low volume:** with 200 requests in a window, p99 is decided by just 2 requests.

**The #1 trap:** measurement that excludes the worst requests. Examples: timeouts recorded as errors but not as latency, a closed-loop load generator that stops sending while the server stalls (coordinated omission), or timing that starts after the request has already waited in a queue.`,
      diagram: `Per-pod p99s:  pod-a 120ms  pod-b 130ms  pod-c 2400ms (hot pod)
avg of p99s  = 883ms   <- meaningless number
fleet p99    = quantile(sum of all buckets)  ~ 2100ms if pod-c has
               a third of traffic
bound check  : min(p99s) <= fleet p99 <= max(p99s)`,
    },
    {
      heading: 'SLA / SLO / SLI — measure the user, promise less than you target',
      body: `**What:** the **SLI** is the measurement (good events ÷ valid events). The **SLO** is the internal target for that SLI over a window. The **SLA** is the external contract with consequences (service credits), and it must be looser than the SLO so you break your own target before you owe anyone money.

**Mechanism:** a good SLI is measured **as close to the user as possible** (edge load balancer, client/RUM, synthetic probes). It counts only *valid* events (drop health checks and client-caused 4xx), and it uses the percentile or threshold users feel ("99% of checkouts under 800 ms", not p50). Availability composes: a hard dependency with a 99.9% SLA caps you near 99.9%, no matter what your own code does.

**Windows:** a rolling 28/30-day window forgives slowly and evenly. A calendar month resets on the 1st, which rewards a burst of risk at month end.

| | Audience | Breach means |
|---|---|---|
| SLI | engineers | a number moved |
| SLO | engineering + product | slow down, spend effort on reliability |
| SLA | customers, legal | credits, penalties, churn |

**The #1 trap:** an SLI measured at the server, which misses the requests that never reached a pod (LB 502s, DNS failures, dead nodes). The server's own metric reads 100% during the outage.`,
    },
    {
      heading: 'Error budgets — policy first, then burn-rate alerts',
      body: `**What:** budget = 1 − SLO. A 99.9% SLO over 30 days allows 0.1% bad requests, or 43.2 minutes of full outage. It is a shared currency: spend it on releases and experiments, and save it by slowing down.

**Burn rate** = observed error ratio ÷ budget ratio. At burn rate 1 you use exactly the whole budget in the window; at 14.4 a 30-day budget is gone in about 50 hours.

| Alert | Long window | Short window | Burn | Budget spent |
|---|---|---|---|---|
| Page | 1h | 5m | 14.4× | 2% |
| Page | 6h | 30m | 6× | 5% |
| Ticket | 3d | 6h | 1× | 10% |

Why two windows: the long window proves the burn is significant, and the short window makes the alert **reset quickly** once you have fixed the problem.

**Policy (write it before you need it):** thresholds for a release freeze (for example >100% spent in the window), exceptions (security fixes), who can override (VP-level, written down), and how dependency or third-party outages count. Low-traffic services need request-count floors or synthetic traffic.

**The #1 trap:** an error budget with no agreed consequence. It becomes a dashboard that product ignores and engineering resents.`,
      code: [
        {
          language: 'yaml',
          title: 'Two-window page alert for a 99.9% SLO (recording rules assumed)',
          code: `groups:
- name: checkout-slo-burn
  rules:
  - alert: CheckoutErrorBudgetFastBurn
    # 14.4 x 0.001 = 1.44% errors sustained over BOTH windows
    expr: |
      slo:checkout_errors:ratio_rate1h > (14.4 * 0.001)
      and
      slo:checkout_errors:ratio_rate5m > (14.4 * 0.001)
    labels: { severity: page }
    annotations:
      summary: 'Checkout burning 2% of 30d budget per hour'
  - alert: CheckoutErrorBudgetSlowBurn
    expr: |
      slo:checkout_errors:ratio_rate6h > (6 * 0.001)
      and
      slo:checkout_errors:ratio_rate30m > (6 * 0.001)
    labels: { severity: page }`,
        },
      ],
      source: 'Google SRE Workbook — Ch 5 Alerting on SLOs',
    },
    {
      heading: 'Canary deployment — a statistical experiment, not a waiting room',
      body: `**What:** send a small slice of real traffic to the new version, compare it against the current version, and then promote it or roll it back automatically.

**Mechanism:** a good canary is a controlled experiment:
- **Baseline, not fleet:** compare the canary with a *freshly deployed baseline of the old version at the same size*. Old pods have warm caches, JIT and long uptimes, so comparing against them biases the result (this is the Kayenta approach).
- **Sample size:** with 0.1% baseline errors, you need tens of thousands of requests to tell a doubling from noise. At 1% of 200 RPS, 10 minutes is only 1,200 requests, which is about 1 expected error.
- **Metrics:** error ratio, latency distribution (not the mean), saturation, and business metrics (checkout conversion).
- **Fail closed:** "no data" means *do not promote*.

**What canaries miss:** slow leaks that exceed a 30-minute window, bugs that only appear at full fleet size (connection counts, cache key explosions), work that only one leader pod or cron runs, rare tenants or data shapes, and irreversible side effects (schema or data migrations).

**The #1 trap:** "5% for 10 minutes, then 100%" with a human watching a dashboard. That is a delay, not a canary.`,
      source: 'Google SRE Workbook — Ch 16 Canarying Releases',
    },
    {
      heading: 'Feature flags — decouple deploy from release, then clean up',
      body: `**What:** runtime switches that change behaviour without a deploy. They come in four kinds: release toggles (short-lived), experiment flags, ops or kill switches (long-lived), and permission or entitlement flags.

**Mechanism:** SDKs fetch a ruleset once, keep it in memory, and **evaluate locally** in microseconds. Updates arrive by streaming (SSE) or polling with an ETag. Percentage rollouts use **deterministic hashing**: bucket = hash(flagKey + ':' + userId) mod 100. The same user then always gets the same variant, and different flags pick *different* user slices. Every call site has a safe default in case the flag store cannot be reached.

**Flag vs canary:** a canary de-risks the *binary* (crashes, leaks, performance) by routing traffic to pods. A flag de-risks the *behaviour* (logic, UX, pricing) for chosen users, tenants or regions, on any pod. You usually need both.

**Lifecycle:** owner, type and expiry date at creation, an alert on stale flags, and removal as part of "done". Kill switches need periodic exercise, because a fallback path that has not run for a year has probably rotted.

**The #1 trap:** Math.random() for percentages, or hash(userId) alone. The first makes users flip between variants on every request; the second puts the same 10% of users into every experiment.`,
      code: [
        {
          language: 'typescript',
          title: 'Deterministic, per-flag bucketing',
          code: `import { createHash } from 'node:crypto';

// 0..9999 bucket, stable for (flag, user); different flags -> independent slices
export function bucketOf(flagKey: string, userId: string): number {
  const digest = createHash('sha1').update(flagKey + ':' + userId).digest();
  return digest.readUInt32BE(0) % 10_000;
}

export function isEnabled(flagKey: string, userId: string, rolloutPct: number): boolean {
  return bucketOf(flagKey, userId) < rolloutPct * 100; // 12.5% -> buckets 0..1249
}`,
        },
      ],
    },
    {
      heading: 'Multi-AZ — surviving a datacentre, not a region',
      body: `**What:** running every tier across two or more availability zones (separate power, cooling and network, about 1–2 ms apart) in one region.

**Mechanism:**
- **Stateless tiers:** spread pods with topology constraints, and size for **N−1 zones** (static stability: survive losing an AZ without launching anything new, because the control plane may be impaired too).
- **Quorum systems** (etcd, ZooKeeper, Raft, Kafka controllers) need an odd count across **3 AZs**. A 3-node cluster with 2 nodes in one AZ loses quorum when that AZ fails.
- **Hidden zonal resources:** NAT gateways, EBS volumes (a pod with a zonal PV cannot move to another AZ), and single-AZ caches.
- **Databases:** synchronous standby in another AZ gives RPO ≈ 0 and failover in 30–120 s.

**Cost:** inter-AZ traffic is $0.01/GB in each direction. Chatty services, Kafka replication and consumers that read from leaders in other zones can quietly add up to a large share of the bill. The fixes are topology-aware routing and Kafka fetch-from-follower (client.rack).

**The #1 trap:** assuming Multi-AZ means highly available. It does not protect you from a bad deploy, a regional control-plane or DNS failure, or data corruption, which are the most common causes of big outages.`,
      code: [
        {
          language: 'yaml',
          title: 'Zone spread plus zone-local traffic preference',
          code: `apiVersion: v1
kind: Service
metadata: { name: pricing }
spec:
  selector: { app: pricing }
  ports: [{ port: 80, targetPort: 3000 }]
  trafficDistribution: PreferClose   # keep calls in-zone when healthy endpoints exist
---
# in the Deployment pod template
topologySpreadConstraints:
- maxSkew: 1
  topologyKey: topology.kubernetes.io/zone
  whenUnsatisfiable: DoNotSchedule
  labelSelector: { matchLabels: { app: pricing } }`,
        },
      ],
    },
    {
      heading: 'Multi-region — latency, residency, and hidden single-region dependencies',
      body: `**What:** running the product in two or more geographic regions for survival of a region-wide failure, lower latency for distant users, or data-residency law.

**Mechanism:**
- **Active-passive** (warm standby / pilot light): simpler data (one writer), RTO of minutes, and capacity that sits idle.
- **Active-active:** every region serves traffic. This needs per-entity home regions or conflict resolution (CRDTs, LWW only where lost updates are fine), plus N+1 capacity: with 3 regions, each needs about 50% headroom to absorb the loss of a neighbour.
- **Physics:** Mumbai↔Singapore is about 60 ms RTT and Mumbai↔Frankfurt about 120 ms. Synchronous cross-region writes add at least one RTT to every commit.

**Hidden dependencies decide whether multi-region works:** identity providers, secrets or KMS, CI/CD, container registries, feature-flag services, DNS **control planes** (Route 53's control plane lives in us-east-1; its data plane and health checks are global), and "global" services hosted in one region. The October 2025 us-east-1 DynamoDB DNS incident took down many apps that thought they were resilient.

**The #1 trap:** failover that needs the failed region (or a control-plane API) to work. Pre-provision the capacity, fail over through data-plane mechanisms (health checks, routing controls), and practise.`,
    },
    {
      heading: 'Disaster Recovery — RPO, RTO, corruption, and proving it',
      body: `**What:** the plan and mechanisms for restoring service after a disaster: region loss, data corruption, ransomware, or a human "DROP TABLE". **RPO** is how much data you can lose; **RTO** is how long you can be down.

**Strategies (AWS DR whitepaper):**

| Strategy | RPO | RTO | Cost |
|---|---|---|---|
| Backup & restore | hours | hours–day | $ |
| Pilot light (data replicated, compute off) | seconds–min | tens of min | $$ |
| Warm standby (scaled-down, running) | seconds | minutes | $$$ |
| Multi-site active-active | ~0 | ~0 | $$$$ |

**Two different disasters need two different tools:**
- *Infrastructure loss* → replication and failover.
- *Logical corruption* (a bad migration, ransomware, a buggy consumer) → replication **faithfully copies the damage**. You need point-in-time recovery, delayed replicas, and **immutable** backups (S3 Object Lock in compliance mode, a separate account and separate credentials).

**Proving it:** scheduled restore tests (restore → checksum → run app smoke tests) and game days with a stopwatch. The RTO you report is the one you measured. Keep the runbook where the disaster cannot reach it.

**The #1 trap:** "we have backups". Until you have restored one on time, from the account an attacker could not reach, you have hope, not DR.`,
      source: 'AWS — Disaster Recovery of Workloads on AWS',
    },
  ],
  codeChallenges: [
    {
      id: 'misc-ops-cc-1',
      title: 'Fix the automated canary gate that promoted a broken release',
      context:
        'The platform team wrote a promotion gate that runs every minute during a canary. Last week it promoted a release that doubled checkout errors and added 400 ms to p99. Canary traffic is 5% of ~300 RPS. Pods expose a Prometheus histogram http_server_request_duration_seconds and a counter http_requests_total, both labelled with version and status.',
      task:
        'Rewrite the gate so it detects real regressions, does not promote on missing or insufficient data, and compares like with like. Keep it as a TypeScript function that returns PROMOTE, WAIT or ROLLBACK.',
      starter: {
        language: 'typescript',
        title: 'canary-gate.ts (starter)',
        code: `import { query } from './prom'; // query(promql): Promise<number>  (NaN when no data)

export async function decide(canaryVersion: string): Promise<'PROMOTE' | 'ROLLBACK'> {
  // error rate of the whole service (canary included)
  const errRate = await query(
    'sum(rate(http_requests_total{service="checkout",status=~"5.."}[1m]))' +
    ' / sum(rate(http_requests_total{service="checkout"}[1m]))',
  );

  // average p99 across canary pods
  const canaryP99 = await query(
    'avg(histogram_quantile(0.99, rate(http_server_request_duration_seconds_bucket' +
    '{service="checkout",version="' + canaryVersion + '"}[1m])))',
  );

  if (errRate > 0.01) return 'ROLLBACK';   // static 1% threshold
  if (canaryP99 > 1.0) return 'ROLLBACK';  // 1 second
  return 'PROMOTE';                        // evaluated after the first minute
}`,
      },
      hints: [
        'What does a comparison with NaN return in JavaScript, and what does the function then decide?',
        'The canary is 5% of traffic. How much can it move a service-wide error rate? What should it be compared against instead?',
        'How many requests does the canary receive in one minute, and how many errors would you expect at a 0.2% baseline? How do you merge p99 across pods correctly?',
      ],
      solution: {
        language: 'typescript',
        title: 'canary-gate.ts (solution)',
        code: `import { query } from './prom';

type Verdict = 'PROMOTE' | 'WAIT' | 'ROLLBACK';
const W = '15m'; // 5% of 300 RPS = 15 RPS -> ~13.5K requests per arm

const sel = (v: string) => 'service="checkout",version="' + v + '"';
const errRatio = (v: string) =>
  'sum(rate(http_requests_total{' + sel(v) + ',status=~"5.."}[' + W + ']))' +
  ' / sum(rate(http_requests_total{' + sel(v) + '}[' + W + ']))';
// merge buckets across pods FIRST, then take the quantile
const p99 = (v: string) =>
  'histogram_quantile(0.99, sum by (le) (rate(http_server_request_duration_seconds_bucket{' +
  sel(v) + '}[' + W + '])))';
const reqs = (v: string) => 'sum(increase(http_requests_total{' + sel(v) + '}[' + W + ']))';

export async function decide(canary: string, baseline: string, elapsedMin: number): Promise<Verdict> {
  const [nC, nB, eC, eB, pC, pB] = await Promise.all([
    query(reqs(canary)), query(reqs(baseline)),
    query(errRatio(canary)), query(errRatio(baseline)),
    query(p99(canary)), query(p99(baseline)),
  ]);

  // Fail closed: any missing series means we cannot judge
  if ([nC, nB, eC, eB, pC, pB].some((x) => !Number.isFinite(x))) {
    return elapsedMin > 30 ? 'ROLLBACK' : 'WAIT';
  }
  // Hard safety stop regardless of sample size
  if (eC > 0.05) return 'ROLLBACK';

  // Not enough evidence yet: ~10K requests per arm to see 0.2% -> 0.4% (80% power)
  if (nC < 10_000 || nB < 10_000) return 'WAIT';

  // Relative comparison to a same-size baseline running the old version
  const errWorse = eC > Math.max(eB * 1.5, eB + 0.001); // ratio + absolute floor
  const latWorse = pC > pB * 1.2 + 0.05;                // 20% + 50 ms slack
  if (errWorse || latWorse) return 'ROLLBACK';

  return elapsedMin >= 20 ? 'PROMOTE' : 'WAIT'; // minimum bake time for leaks/warm-up
}`,
      },
      explanation: `**Fixes:**
- **Fail closed on no data.** In the starter, NaN > 0.01 is false, so a canary that emitted no metrics (crash-looping, mislabelled) was promoted. The solution waits, then rolls back if data never arrives.
- **Compare canary vs baseline, not the whole service.** A 5% canary whose errors double from 0.2% to 0.4% moves the service-wide ratio from 0.2% to 0.21%, invisible against a static 1% threshold. The solution compares canary and baseline, the same version split Kayenta uses, with a relative threshold and an absolute floor.
- **Sample size.** 5% of 300 RPS for 1 minute is ~900 requests, about 2 expected errors. The solution requires ~10,000 requests per arm (enough to detect 0.2% → 0.4% with ~80% power) and a 15-minute window before judging, plus a minimum bake time for leaks and warm-up effects.
- **Correct percentile aggregation.** avg(histogram_quantile(...)) computes per-pod p99s and averages them. The solution sums buckets by le, then takes one quantile.
- **Three outcomes.** WAIT separates "not enough evidence" from "good", and a hard safety stop (5% errors) catches disasters immediately.`,
      followUps: [
        {
          "q": "The canary passes the gate, but there's a memory leak that only causes OOMs after 2 hours. How do you extend the gate to catch it?",
          "a": "Add resource-trend checks: compare the canary's memory growth rate (slope of RSS or heap over the bake window via `deriv()` on `process_resident_memory_bytes`) with the baseline's. A canary growing at 50 MB per 10 minutes while the baseline is flat is a regression even before any errors. Extend the bake time for releases touching memory-sensitive code, or do a staged rollout where each stage holds for an hour with these checks. Also watch restart counts and GC pause times. Long-tail problems like leaks need time, so complement canaries with post-rollout SLO and saturation alerts."
        },
        {
          "q": "How do you test the gate itself, so it doesn't promote broken releases again?",
          "a": "Treat it as code with fixtures. Unit tests: mock `query()` to return NaN for the canary series and assert WAIT, then ROLLBACK after 30 minutes; inject eC = 0.004, eB = 0.002 with 12K requests each and assert ROLLBACK; same error rates with 900 requests and assert WAIT; latency +500 ms and assert ROLLBACK. Integration test: deploy a deliberately broken 'chaos' release (returns 1% 500s, adds 400 ms) to a staging canary and assert the gate rolls it back within the expected time. Run this regularly, because a gate that never says no is indistinguishable from a broken gate."
        }
      ],
    },
    {
      id: 'misc-ops-cc-2',
      title: 'Make the regional failover script safe to run at 3 a.m.',
      context:
        'The company runs active-passive: primary in ap-south-1 (Mumbai), warm standby in ap-southeast-1 (Singapore) with an async Postgres replica. An engineer wrote a failover script that a cron job runs every 30 seconds. During a 40-second network blip it failed over, both regions accepted writes for 12 minutes, and 3,000 orders had conflicting IDs.',
      task:
        'Rewrite the failover logic so it only fails over on a sustained, confirmed regional failure, never lets two regions accept writes, knows how much data it will lose, and does not depend on the failed region or on control-plane APIs during the event.',
      starter: {
        language: 'typescript',
        title: 'failover.ts (starter)',
        code: `import { Route53Client, ChangeResourceRecordSetsCommand } from '@aws-sdk/client-route-53';
import { promoteReplica } from './db';

const r53 = new Route53Client({ region: 'ap-south-1' });

export async function tick() {
  const ok = await fetch('https://api.mumbai.internal/health')
    .then((r) => r.ok)
    .catch(() => false);
  if (ok) return;

  // primary looks down: promote Singapore and repoint DNS
  await promoteReplica('ap-southeast-1');
  await r53.send(new ChangeResourceRecordSetsCommand({
    HostedZoneId: 'Z123',
    ChangeBatch: { Changes: [{ Action: 'UPSERT', ResourceRecordSet: {
      Name: 'api.example.com', Type: 'CNAME', TTL: 300,
      ResourceRecords: [{ Value: 'api.singapore.internal' }],
    } }] },
  }));
}`,
      },
      hints: [
        'How many observers, and how many consecutive failures, does it take before this script acts? What if the prober itself is the one cut off?',
        'After the Singapore replica is promoted, what stops Mumbai application pods from continuing to write to the Mumbai primary?',
        'Which AWS APIs are control-plane calls, and where does Route 53\'s control plane run? What does a 300 s TTL do to your RTO?',
      ],
      solution: {
        language: 'typescript',
        title: 'failover.ts (solution)',
        code: `import { probeFromVantagePoints, replicaLagSeconds, promoteReplica } from './dr';
import { setRoutingControl } from './arc';   // data-plane routing control (pre-created)
import { fenceRegionWrites, pageHuman, awaitApproval } from './ops';

const REQUIRED_FAILING_PROBES = 3;   // of 5 vantage points in 3+ other regions
const REQUIRED_CONSECUTIVE = 6;      // 6 x 30 s = 3 min sustained
const MAX_AUTO_RPO_S = 5;            // above this, a human must accept the loss
let consecutive = 0;

export async function tick(): Promise<void> {
  const results = await probeFromVantagePoints('https://api.mumbai.example.com/deep-health', 2_000);
  const failing = results.filter((r) => !r.ok).length;
  consecutive = failing >= REQUIRED_FAILING_PROBES ? consecutive + 1 : 0;
  if (consecutive < REQUIRED_CONSECUTIVE) return;

  await pageHuman('Mumbai failing from ' + failing + '/5 vantage points for 3 min');

  // 1. Know the RPO before acting (measured on the replica side, in Singapore)
  const lag = await replicaLagSeconds('ap-southeast-1');
  if (lag > MAX_AUTO_RPO_S && !(await awaitApproval('RPO would be ' + lag + ' s'))) return;

  // 2. Fence: stop old-region writers first (flag read locally by apps; DB role revoke if reachable)
  await fenceRegionWrites('ap-south-1'); // best effort; must not block the failover

  // 3. Promote the replica; bump the writer epoch so stale writers are rejected
  await promoteReplica('ap-southeast-1', { newEpoch: Date.now() });

  // 4. Shift traffic with a data-plane control (health-check-backed records, TTL 30 s)
  await setRoutingControl('mumbai-cell', 'OFF');
  await setRoutingControl('singapore-cell', 'ON');
  consecutive = 0;
}`,
      },
      explanation: `**Fixes:**
- **Confirm the failure before acting.** One failed probe from one location could be the prober's own network. The solution needs 3 of 5 vantage points in other regions, failing for 3 minutes in a row, to hit a deep health check. That removes the 40-second-blip failover.
- **Fence before promoting.** The split-brain happened because Mumbai pods kept writing to the Mumbai primary. The solution fences old-region writes (a locally cached flag, revoking the DB role when reachable) and promotes with a new writer epoch, so late writes carrying the old epoch are rejected.
- **Know the RPO.** With async replication, failover loses everything not yet replicated. The script measures lag on the Singapore side and needs a human to accept a loss beyond 5 s. That is a business decision, not a cron job's.
- **Data-plane failover.** The Route 53 ChangeResourceRecordSets API is a control-plane call served from us-east-1, and a client pinned to the failed region adds another dependency. The solution flips pre-created routing controls with health-check-backed records and a short TTL. The 300 s TTL in the starter alone would blow a 5-minute RTO.
- **Humans stay in the loop.** Paging and approval gates turn an automatic foot-gun into a fast, assisted failover.`,
      followUps: [
        {
          "q": "Fencing Mumbai writes is 'best effort' because Mumbai may be unreachable. What prevents split-brain if the Mumbai app keeps writing to the Mumbai DB anyway?",
          "a": "Writes in Mumbai can't be stopped from outside if Mumbai is isolated, so make them harmless. The new writer epoch means Singapore's DB rejects anything stamped with the old epoch. When connectivity returns, the old Mumbai primary must not resume as primary: treat it as a demoted node, rebuild it as a replica from Singapore (pg_rewind), and extract any orders written in Mumbai after the cut-off for manual reconciliation. Mumbai apps can also self-fence: if they can't reach a quorum of out-of-region witnesses for 60 s, they stop accepting writes, trading availability for no split-brain."
        },
        {
          "q": "How do you rehearse this failover without risking production?",
          "a": "Run game days with gradual scope. First in a staging environment that mirrors production topology, inject failure by blocking Mumbai's network at security-group level, and time each step: detection, paging, decision, promotion, routing flip, client convergence, measured against the RTO. Then in production during low traffic with an announced window: fail over a single non-critical service or cell, measure replica lag at promotion (the real RPO), and fail back. Record the runbook gaps found. Make the drill quarterly and include the human approval step, since decision time dominates the RTO."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'misc-ops-iq-01',
      difficulty: 'medium',
      question:
        'A teammate pushes back on your plan to split the order pipeline into services. His evidence: Amazon Prime Video moved a monitoring pipeline from serverless microservices back into one process and cut its bill by about 90%. How do you respond?',
      whatInterviewerLooksFor: [
        'Knows what the Prime Video case was really about (per-frame orchestration and S3 hand-offs), not "microservices are bad"',
        'Frames the decision around boundaries, data movement and team ownership',
        'Can state when the teammate is right',
        'Avoids tribal "monolith vs microservices" arguments',
      ],
      modelAnswer: `### What actually happened
The Prime Video team's detector pipeline ran each stage as a separate serverless component. It was orchestrated per video frame by Step Functions, with intermediate frames written to and read back from S3. The cost was **state transitions and data shuffling between components for work that was really one tight loop**. Moving the stages into one process (still deployed as a scalable ECS service) removed that overhead.

### The lesson
- It is not "microservices are bad". It is that **a boundary on a hot, data-heavy inner loop is expensive**. Every hop costs serialisation, network, orchestration fees and failure handling.
- Boundaries pay off when the parts have **different owners, change cadences, scaling profiles or failure-isolation needs**.

### Applying it to our order pipeline
- If validation → pricing → reservation run in the same request, are changed by the same team and share data, they are one service with clean internal modules.
- If payments has a separate team, PCI scope and its own release cadence, it earns a boundary.
- I'd quantify: calls per order, bytes moved per hop, the p99 budget, and how often each part deploys.

### When he is right
Whenever we would cut through a high-frequency loop, or create services that always ship together.`,
      followUps: [
        {
          q: 'How do you keep the monolith from turning into a ball of mud if you do not split it?',
          a: 'Modular monolith: enforce module boundaries with lint or ArchUnit-style rules (no cross-module imports except through public interfaces), a schema per module, and in-process events. Splitting later becomes an extraction, not a rewrite.',
        },
        {
          q: 'What metric would tell you a boundary is too chatty?',
          a: 'Calls per edge request across that boundary (for example more than 3 calls per request), share of latency spent on network/serialisation in traces, and how often the two services deploy together (co-change frequency).',
        },
      ],
      pitfalls: [
        'Citing the case as proof that microservices are a mistake',
        'Arguing only about scaling, not ownership and data flow',
        'No numbers: hops, bytes, deploy frequency',
      ],
    },
    {
      id: 'misc-ops-iq-02',
      difficulty: 'hard',
      question:
        'Our Pricing and Promotions services are owned by the same team, deploy together in 90% of releases, share a promotions table, and Pricing calls Promotions 6 times per price computation. The team wants to merge them. How do you decide, and how do you merge safely without downtime?',
      whatInterviewerLooksFor: [
        'Treats merging as a normal architectural move with clear criteria',
        'Uses evidence: co-change, call patterns, data sharing, team ownership',
        'Has a safe, reversible migration plan (strangler in reverse)',
        'Thinks about API consumers, data ownership, deploy pipelines and observability after the merge',
      ],
      modelAnswer: `### Decide with evidence
Signals that this is **one bounded context split in two**:
- **Co-change:** 90% of releases touch both, so the boundary buys no deploy independence.
- **Chattiness:** 6 synchronous calls per price computation. At ~1 ms each plus tail effects (1 − 0.99^6 ≈ 6% of computations hit a p99 somewhere), this adds latency and failure modes for nothing.
- **Shared table:** they already share data, so the "database per service" isolation is fictional.
- **One team:** no organisational reason to keep the split.

Counter-signals I would check: very different scaling profiles (Promotions batch-recomputes nightly?), different compliance scope, or plans to hand Promotions to another team.

### Merge plan (reverse strangler)
1. **Module first:** copy Promotions logic into Pricing as an internal module behind the same interface. Keep the HTTP client as a fallback adapter.
2. **Flag the call path:** a flag switches Pricing from remote to in-process calls. Shadow-compare results for a week (log mismatches).
3. **External consumers:** keep the Promotions API alive as a thin facade routed to the merged service (gateway route change), and announce deprecation.
4. **Data:** the table stays; ownership and migrations move to one repo. Remove the second service's credentials.
5. **Delete:** remove the old service, its pipeline, dashboards and alerts. Merge the SLOs.

### After the merge
One deploy pipeline, one on-call, and internal module boundaries enforced by lint rules so it can be split again if ownership changes.`,
      followUps: [
        {
          q: 'Another team consumes Promotions events from Kafka. What changes?',
          a: 'Nothing for them if the merged service keeps publishing the same topic and schema. Topic ownership moves with the code, and the schema registry compatibility rules still apply.',
        },
        {
          q: 'How do you measure co-change objectively?',
          a: 'Mine git and deploy history: the share of PRs or releases touching both repos in the same window, and the number of contract changes needing coordinated deploys. Anything above ~30–40% is a strong coupling signal.',
        },
        {
          q: 'Could you have just added caching of promotions inside Pricing instead?',
          a: 'It reduces the chatty calls but keeps coordinated deploys and the shared table. It is a patch for latency, not for the coupling.',
        },
      ],
      pitfalls: [
        'Treating "microservices" as a one-way door',
        'Big-bang merge with no shadow comparison or fallback',
        'Forgetting external consumers of the API and events',
      ],
    },
    {
      id: 'misc-ops-iq-03',
      difficulty: 'medium',
      question:
        'You have OpenTelemetry auto-instrumentation on every NestJS service. Which spans and attributes do you add by hand, and which do you deliberately leave out?',
      whatInterviewerLooksFor: [
        'Knows what auto-instrumentation captures (HTTP, gRPC, DB, Redis, Kafka clients) and what it misses',
        'Adds business context and in-process waits',
        'Understands cardinality/cost differences between span attributes and metric labels',
        'Knows the PII and cost limits',
      ],
      modelAnswer: `### What auto-instrumentation already gives
Server spans for HTTP and gRPC, client spans for pg, ioredis, fetch and kafkajs, and context propagation through the standard headers. That shows **where** time goes between processes, but not **why**, or what happens inside one process.

### What I add
- **Business attributes on the root span:** tenant_id, tenant tier, plan, feature-flag variants, cart size, payment method, API client id. These let me ask "is it only enterprise tenants on the new pricing flag?"
- **In-process waits:** DB pool acquire, mutex or lock wait, event-loop queue time, in-memory queue time before a worker picks up a job. Auto spans start at the query, so pool starvation looks like a mysterious gap.
- **Decision points as attributes or events:** cache hit/miss, retry attempt number, circuit-breaker state, fallback served, which shard/region was chosen.
- **Expensive CPU sections:** PDF rendering, JSON serialising large payloads, crypto.

### What I leave out
- PII (emails, card data), request/response bodies, secrets.
- A span per loop iteration: use counters or an attribute (items_processed) instead.
- Attributes with huge values (full SQL with literals). Use the parameterised statement.

### Cost awareness
High-cardinality attributes are fine on spans because they are sampled (tail sampling keeps errors and slow traces). The same fields as metric labels would explode the series count.`,
      followUps: [
        {
          q: 'How do you make sure teams actually add the same attribute names?',
          a: 'A shared instrumentation library with typed helpers (setTenant(), setFlagVariants()) that follows OTel semantic conventions plus an app.* namespace, and a CI check or collector processor that flags unknown keys.',
        },
        {
          q: 'Where does the flag variant come from without every handler setting it?',
          a: 'Hook the flag SDK evaluation event: each evaluation adds an attribute (or span event) to the active span, so it happens automatically.',
        },
      ],
      pitfalls: [
        'Adding user_id as a Prometheus label "for debugging"',
        'Wrapping every function in a span, which makes traces unreadable and expensive',
        'Logging request bodies with PII into traces',
      ],
    },
    {
      id: 'misc-ops-iq-04',
      difficulty: 'expert',
      question:
        'Your observability stack (Prometheus, Loki, Tempo, Grafana, Alertmanager) runs in the same Kubernetes cluster and region as production. Design it so that you can still detect, page and debug when that region is having a disaster.',
      whatInterviewerLooksFor: [
        'Identifies that the monitoring shares fate with what it monitors',
        'Separates alerting and paging paths from the heavy query/storage stack',
        'Uses external synthetic probes and meta-monitoring (dead man\'s switch)',
        'Handles access: SSO, secrets and runbooks when the region is down',
        'Considers cost and data locality trade-offs',
      ],
      modelAnswer: `### Problem: shared fate
If the region, cluster, DNS or identity provider fails, the dashboards, alert evaluator and pager integration fail too. You find out from Twitter.

### Design
**1. Outside-in detection (independent of the region)**
- Synthetic probes from several other regions and a third-party provider hit the public edge and a few deep endpoints (login, checkout dry-run).
- They alert through a pager service directly, not through our Alertmanager.

**2. Dead man's switch / meta-monitoring**
- Each regional Prometheus fires an always-on "Watchdog" alert to an external heartbeat service. If the heartbeat stops for 5 minutes, it pages: "monitoring itself is down."

**3. Split the pipeline: alerting light, storage heavy**
- Alert evaluation for SLO burn-rate rules runs in a **second region** too (a small Prometheus/Mimir ruler fed by remote-write or by federation of recording rules only, a few thousand series).
- Full-fidelity logs and traces stay in-region for cost and data residency (cross-region transfer of 8 TB/day of logs would be expensive). Only aggregates and error samples replicate.

**4. Access during the disaster**
- Break-glass accounts that do not depend on the regional SSO. Grafana in the secondary region with read access to replicated aggregates.
- Runbooks exported to a separate static site or wiki outside the platform.

**5. Test it**
- Game day: black-hole the primary region's monitoring namespace and check that pages still arrive within the target (for example 5 minutes) and that on-call can open a dashboard.

### Trade-off
Duplicating everything costs about 2×. Duplicating only **detection and paging** costs a few percent and covers the scenario that matters: knowing, fast, that you are down.`,
      followUps: [
        {
          q: 'Your pager provider itself has an outage. Now what?',
          a: 'Use a second notification channel with independent infrastructure (SMS gateway or a second vendor) for the highest-severity synthetic alerts. Test it quarterly.',
        },
        {
          q: 'Why not just use a SaaS observability vendor?',
          a: 'That solves shared fate with your region (if the vendor runs elsewhere) but adds vendor-outage risk, data egress cost and residency concerns. Many teams keep external synthetics plus a heartbeat even with SaaS.',
        },
      ],
      pitfalls: [
        'Assuming Grafana Cloud or any single SaaS removes all shared-fate risk',
        'No dead man\'s switch, so silence is read as health',
        'Replicating full log volume cross-region without costing it',
      ],
    },
    {
      id: 'misc-ops-iq-05',
      difficulty: 'medium',
      question:
        'A dashboard shows "p99 latency" as the average of per-pod p99s, and a report averages the 60 per-minute p99s to get the hourly p99. Why are both wrong, and what should be computed instead?',
      whatInterviewerLooksFor: [
        'States clearly that percentiles are not additive or averageable',
        'Explains with a concrete example of how averaging hides the tail',
        'Knows mergeable representations: histograms, HDR, t-digest, DDSketch',
        'Knows the useful bounds (max of p99s is an upper bound)',
      ],
      modelAnswer: `### Why it's wrong
A percentile is a **position in a distribution**, not a quantity. Averaging positions from different distributions has no meaning, and it systematically **hides the tail you care about**.

Example: 10 pods with equal traffic. Nine have p99 = 100 ms. One hot pod (a noisy neighbour) serves 30% of its requests above 1 s, so its p99 is 2 s. The average of the p99s is 290 ms. But that hot pod alone puts 3% of *all* fleet requests above 1 s, so the true fleet p99 is **above 1 s**.

Over time, the same thing happens: a 5-minute incident where p99 is 4 s averages into the hour as ~0.4 s, while about 8% of the hour's requests actually saw the bad minutes.

### What to do
- Keep **mergeable distributions**: Prometheus histograms (sum bucket rates by le, then histogram_quantile), HDR histograms, t-digest or DDSketch in the metrics backend.
- For long windows, compute the quantile from the **summed buckets over the whole window** (for example rate over 1h), not from minute-level quantiles.
- Prometheus summaries (client-side quantiles) cannot be aggregated across pods. Avoid them for fleet views.

### Useful bounds when all you have is per-pod p99
min(p99) ≤ fleet p99 ≤ max(p99). The max is a safe pessimistic number, and it is often closer to the truth than the average.`,
      followUps: [
        {
          q: 'Is an SLO like "99% of requests under 300 ms" easier to aggregate than p99?',
          a: 'Yes. It is a ratio of counts (requests under 300 ms ÷ all requests), and counts add across pods and time. That is one reason SLOs are often written as threshold ratios rather than "p99 < X".',
        },
        {
          q: 'What error does histogram bucketing itself introduce?',
          a: 'Linear interpolation inside the bucket: if the buckets are 250 ms and 500 ms, a p99 of "310 ms" could really be anywhere in that range. Put bucket edges at the SLO thresholds.',
        },
      ],
      pitfalls: [
        'Saying "averaging is fine if pods get equal traffic" (it still is not)',
        'Recommending summaries for fleet-wide percentiles',
        'Not knowing any mergeable sketch',
      ],
    },
    {
      id: 'misc-ops-iq-06',
      difficulty: 'hard',
      question:
        'After a release, the checkout dashboard shows p99 dropping from 900 ms to 300 ms, and the team celebrates. The same week, support tickets about "checkout hangs" double. How can both be true, and how do you find out what is going on?',
      whatInterviewerLooksFor: [
        'Suspects the measurement before the users',
        'Knows the ways slow requests fall out of a latency histogram (timeouts, errors, client aborts, queueing before the timer)',
        'Checks the error and volume signals alongside latency',
        'Uses client-side/RUM or LB data to cross-check',
        'Proposes durable fixes to the measurement',
      ],
      modelAnswer: `### A faster p99 can mean the slow requests stopped being counted
Likely mechanisms:
1. **Timeouts left out of the histogram.** The release added a 300 ms timeout (or a new circuit breaker) and records latency only for successful responses. The slow requests now become errors or fallbacks, and the latency panel only sees the fast survivors.
2. **Client aborts.** Middleware records duration on the response 'finish' event. Requests where the client gives up fire 'close' but never 'finish', so they vanish from the histogram.
3. **The timer starts too late.** The measurement moved inside the handler (after body parsing, auth, or a queue in front of a worker pool). Time spent waiting in a queue or on event-loop lag is invisible.
4. **Mix shift.** Fast requests (a new polling endpoint, health checks) went into the same histogram, so the tail is diluted.
5. **Volume drop.** Users give up. Fewer slow requests arrive, and the ones that arrive look fine.

### How I investigate
- Put **error ratio, request count and p99 on one panel**, split by version. If errors or 499s rose as p99 fell, that is mechanism 1 or 2.
- Compare with an **independent vantage point**: LB/ingress latency (which includes queueing and aborts) and RUM or client-side timings for "checkout submit to confirmation".
- Pull traces for the ticketed sessions (by user id) and see where the time went.

### Fix the measurement
Record latency for **every** outcome (label it by status class), measure from the edge, and track client-perceived latency in the SLO. Make it a rule that a latency improvement must come with a stable request volume and error rate.`,
      followUps: [
        {
          q: 'The release did add a 300 ms timeout with a cached fallback price. Is that bad?',
          a: 'Not necessarily. It may be a real improvement if the fallback is acceptable. But the SLI must count fallbacks (or degraded responses) explicitly, so you see "18% of checkouts served stale price" instead of a flattering p99.',
        },
        {
          q: 'How does coordinated omission relate to this?',
          a: 'It is the same family of bias. When the system stalls, a closed-loop measurer stops sending or recording, so it samples the good moments far more than the bad ones. Measure latency from the intended send time, or use open-loop load.',
        },
      ],
      pitfalls: [
        'Assuming customers are wrong because the dashboard is green',
        'Looking only at latency, not at error rate and volume at the same time',
        'Not knowing where the timer starts and stops in their own middleware',
      ],
    },
    {
      id: 'misc-ops-iq-07',
      difficulty: 'medium',
      question:
        'Define SLI, SLO and SLA in one line each. Then: reliability of your API has been sliding for two quarters. Which of the three would you change first, and why?',
      whatInterviewerLooksFor: [
        'Crisp definitions with the right audiences',
        'Knows the SLA must be looser than the SLO',
        'Starts by checking whether the SLI measures what users feel',
        'Avoids "just lower the SLO" or "raise the SLA"',
      ],
      modelAnswer: `### Definitions
- **SLI:** a measurement of good events ÷ valid events (for example checkouts answered 2xx within 800 ms ÷ all non-4xx checkouts).
- **SLO:** the internal target for an SLI over a window (99.9% over 28 days).
- **SLA:** the external contract with consequences (credits below 99.5%). It is always looser than the SLO so there is a buffer.

### What I'd change first: look at the SLI
Before changing any target, I check whether the SLI **reflects user pain**:
- Is it measured at the server? Then it misses LB 502s, DNS and client timeouts, so the real slide may be worse than the number shows.
- Is it p50 or an average? Then the tail users feel is invisible.
- Are health checks or bots in the denominator? They inflate the success rate.
- Does it cover the key journeys (login, search, checkout) or just "all HTTP"?

A trustworthy SLI tells me whether the slide is real and where it is.

### Then the SLO, as a policy lever
If the SLI is right and we keep missing the SLO, the SLO is doing its job: the error-budget policy should shift engineering time to reliability. I would only lower the SLO if users are clearly fine at the current level (support tickets and churn say so), because an unrealistic target that is always red gets ignored.

### The SLA last
The SLA is a legal and commercial promise. You tighten it only after you have beaten the SLO with a comfortable margin for several quarters.`,
      followUps: [
        {
          q: 'Why keep the SLO stricter than the SLA?',
          a: 'So you get an early warning and room to act before the contract is broken. For example, an SLO of 99.95% against an SLA of 99.9% gives you roughly 22 minutes a month between "we missed our target" and "we owe credits".',
        },
        {
          q: 'Who should own the SLO?',
          a: 'Jointly: product decides what level users need, engineering says what it costs, and SRE/platform supplies measurement. The service team is accountable for meeting it.',
        },
      ],
      pitfalls: [
        'Using SLA and SLO interchangeably',
        'Proposing to raise the SLA to "force" reliability',
        'Never questioning whether the SLI itself is correct',
      ],
    },
    {
      id: 'misc-ops-iq-08',
      difficulty: 'hard',
      question:
        'Sales has just signed an enterprise deal promising 99.99% monthly availability for our payments API, with 25% credits on breach. Our measured availability over the last six months is 99.95%, and the card-network gateway we depend on only commits to 99.9%. What do you do?',
      whatInterviewerLooksFor: [
        'Does the arithmetic: minutes per month at each level, dependency caps',
        'Distinguishes what can be engineered and what must be renegotiated or redefined',
        'Proposes concrete mitigations for the hard dependency (multi-provider, async acceptance)',
        'Handles the organisational side: SLA definitions, exclusions, the process for future deals',
      ],
      modelAnswer: `### Numbers first
- 99.99% ≈ **4.4 min/month**. 99.95% ≈ 22 min. 99.9% ≈ 43.8 min.
- A single synchronous hard dependency at 99.9% caps us at roughly 99.9% for that path, no matter how good our code is. We are currently about 5× over the promised downtime.

### Short term: limit the damage
- Read the contract definitions. How is availability measured (our edge? monthly? per-request or per-minute)? What exclusions exist (maintenance windows, upstream network failures, force majeure)? Often the definition, not the architecture, decides whether you breach.
- Start measuring the SLA exactly as the contract defines it, per customer, from the edge, now.

### Engineering: remove the dependency cap
- **Second gateway / acquirer** with health-based routing: two independent 99.9% providers in parallel give about 99.9999% for that component (if failures really are independent and failover is fast).
- **Accept-then-process** where the business allows: accept the payment intent (idempotent, durable) and complete authorisation asynchronously with retries. Customer-visible availability then depends on our ingestion path, not on the gateway.
- Fix our own 22 minutes: look at the top causes of budget burn (deploys? DB failovers?) and address them. Canary plus automatic rollback, and faster DB failover.

### Organisational
- Set an internal SLO tighter than the SLA (for example 99.995% on the ingestion path) with an error-budget policy.
- Change the sales process: SLA commitments must be reviewed against measured SLOs and dependency SLAs before signing.
- Price the risk: expected credits × probability of breach, compared with the cost of the second provider.`,
      followUps: [
        {
          q: 'The customer insists the SLA covers end-to-end authorisation, not just acceptance. Now?',
          a: 'Then multi-acquirer routing is mandatory, plus per-provider circuit breakers and pre-negotiated capacity on the secondary. You still document an exclusion for card-network-wide outages, which no merchant controls.',
        },
        {
          q: 'How do you compute availability for the SLA: per minute or per request?',
          a: 'Per-request (good ÷ valid) is fairer for high traffic. Per-minute ("a minute is bad if >5% errors") is common in contracts and easier to audit. Whatever the contract says, measure it exactly that way.',
        },
      ],
      pitfalls: [
        'Promising to "add more replicas" when the cap is an external dependency',
        'Ignoring the contract\'s measurement definition and exclusions',
        'Assuming two providers are independent without checking shared infrastructure',
      ],
    },
    {
      id: 'misc-ops-iq-09',
      difficulty: 'medium',
      question:
        'It is the 15th of the month, and your service has burned 80% of its 30-day error budget. What happens now, and what would you want to already be written down?',
      whatInterviewerLooksFor: [
        'Checks whether the burn is ongoing or was one incident',
        'Refers to a pre-agreed error-budget policy',
        'Proportionate response: slow releases and prioritise fixes, not panic',
        'Understands rolling vs calendar windows',
      ],
      modelAnswer: `### First, understand the burn
- **One big incident or a steady leak?** If one 30-minute outage used most of the budget, the priority is making sure its postmortem actions land. If it is a steady 0.1% error trickle, current burn is ~1× and the budget runs out around day 18–19.
- **Current burn rate:** at 1×, 20% of the budget lasts about 6 days. At 3×, about 2 days.

### Then, apply the error-budget policy
A typical policy (agreed in advance by product and engineering):
- **Above 75% spent:** risky launches need sign-off; deploy only with canary and automatic rollback; the on-call-heavy team's next sprint is weighted toward reliability.
- **Above 100% spent:** feature freeze for that service except P0/security fixes, until the rolling window recovers or the top reliability items ship.
- **Exceptions:** who can override (for example a director, with written reasoning), and how outages caused by dependencies are counted.

### Rolling window detail
With a rolling 28/30-day window, the budget comes back as bad days age out. An incident on day 3 "returns" its budget on day 31. With a calendar month it resets on the 1st, which encourages end-of-month risk. I prefer rolling windows.

### What should already exist
The policy doc, SLO dashboards showing budget remaining and burn rate, burn-rate alerts (so 80% was not a surprise), and a monthly SLO review that looks at the top budget consumers.`,
      followUps: [
        {
          q: 'Most of the burn came from a cloud provider incident. Does it count?',
          a: 'Users felt it, so the SLI should show it. The policy can say how to respond: for example no freeze for a provider outage, but an action item to reduce that dependency (multi-AZ, fallback). Hiding it from the SLI hides a real risk.',
        },
        {
          q: 'How do you avoid the freeze turning into "ship everything on the 1st"?',
          a: 'Rolling windows, plus a normal canary process after the freeze. Releases are batched only if they are small, and each still goes through the pipeline.',
        },
      ],
      pitfalls: [
        'Instant hard freeze without looking at the current burn rate',
        'No pre-agreed policy, so decisions are made in a heated meeting',
        'Quietly relaxing the SLO to get back to green',
      ],
    },
    {
      id: 'misc-ops-iq-10',
      difficulty: 'expert',
      question:
        'Your checkout service is over its error budget. The PM wants to launch a revenue feature Friday because "marketing is booked". Engineering wants a freeze. Design the error-budget policy that settles this kind of fight, and tell me what you would decide this Friday.',
      whatInterviewerLooksFor: [
        'Frames the budget as a shared, pre-agreed decision tool, not an engineering veto',
        'The policy has thresholds, actions, exceptions, escalation and review',
        'Finds ways to ship safely (flag, dark launch, small cohort) instead of yes/no',
        'Considers the burn causes and whether the launch touches them',
        'Communicates with numbers and business impact',
      ],
      modelAnswer: `### Principles of the policy
1. **Signed in advance** by the product and engineering leads, and reviewed every quarter.
2. **Proportional thresholds** (rolling 28 days):
   - < 50% spent: normal velocity.
   - 50–100%: launches need a rollback plan, a feature flag and a canary; at least one reliability item per sprint.
   - > 100%: releases limited to reliability, security and legal fixes, *or* launches that meet the "safe launch" exception.
3. **Safe-launch exception:** allowed while over budget if the feature is behind a kill switch, off by default, ramped by cohort (1% → 10% → 50%), has its own SLI, and does not touch the components that burned the budget.
4. **Escalation:** disagreement goes to a named exec (for example VP Eng + VP Product) who decides in writing. The decision and the risk are recorded.
5. **Accounting rules:** how dependency outages, planned maintenance and bot traffic count.
6. **Exit criteria:** the freeze ends when the rolling budget is positive *or* the top 3 postmortem actions are shipped.

### This Friday
- **Why are we over budget?** If it was a payment-provider incident and the feature is a new UI promo, it is low coupling: ship it behind a flag with a 5% ramp on Friday, full ramp Monday after a weekend of data.
- If the burn came from the checkout DB, and the feature adds new queries to that DB: no. We offer marketing a dark launch (page live, feature enabled for internal users and 1%), and set the full date for when the DB fix lands.
- Either way: no Friday-evening full ramp. Watch the burn-rate alerts on the feature's own SLI, and the on-call knows the kill switch.

### Why this works
It turns "engineering vs product" into "which risk, how much, who owns it", decided with numbers the two leads already agreed to.`,
      followUps: [
        {
          q: 'The PM says the policy slows the business. How do you answer?',
          a: 'Show data: the lost revenue and the support cost of the incidents that burned the budget, compared with a delay of days. Also point out that the policy lets you ship whenever reliability is fine, which is most months. It is permission to go fast, not only a brake.',
        },
        {
          q: 'What if a team is never out of budget?',
          a: 'The SLO may be too loose, or the team is too cautious. An untouched budget is a signal to ship faster, run more experiments or run chaos tests, or to tighten the SLO if users need it.',
        },
      ],
      pitfalls: [
        'Binary "freeze or ship" with no middle ground',
        'Policy that engineering wrote alone and product never agreed to',
        'Ignoring whether the new feature touches the failing component',
      ],
    },
    {
      id: 'misc-ops-iq-11',
      difficulty: 'medium',
      question:
        'In automated canary analysis, why do teams compare the canary against a newly deployed baseline of the old version, rather than against the rest of the production fleet or a fixed threshold?',
      whatInterviewerLooksFor: [
        'Knows the confounders: uptime, cache warmth, JIT, connection pools, node placement',
        'Knows a fixed threshold ignores normal variation and traffic mix',
        'Mentions statistical comparison and sample-size concerns',
        'Can describe the setup concretely (same size, same traffic weight)',
      ],
      modelAnswer: `### The goal
To isolate **one variable: the code change**. Anything else that differs between the groups becomes noise, or worse, a biased result.

### Why not the existing fleet?
- **Age effects:** fleet pods have been up for days. Warm caches, JIT-optimised code, established connection pools, but also memory fragmentation and slow leaks. A fresh canary pod looks worse (cold) or better (no leak) for reasons unrelated to the change.
- **Size effects:** 1 canary pod against 50 fleet pods gives very different variance and a different share of noisy neighbours.
- **Placement:** the canary may land on a newer node type or a different AZ.

A **baseline** is deployed at the same time, with the same size and traffic weight (say 1 pod each at 5%), running the old version. Canary and baseline then differ only in code.

### Why not a fixed threshold?
- Normal error rate and latency move with traffic mix and time of day. A threshold loose enough to avoid false alarms at peak will miss a doubling from 0.1% to 0.2%.
- A relative comparison (canary vs baseline over the same window) cancels the shared noise.

### How it is judged
Kayenta-style analysis compares the distributions of many metrics (error ratio, latency, CPU, GC) with a statistical test (for example Mann-Whitney U), classifies each as pass, high or low, and aggregates them into a score. There must be a minimum sample size, and a "no data" result must fail.`,
      followUps: [
        {
          q: 'Traffic is tiny at night. How do you still canary?',
          a: 'Lengthen the window, raise the canary weight, add synthetic traffic for the critical paths, or schedule risky deploys for business hours. Otherwise you are waiting, not testing.',
        },
        {
          q: 'Does a baseline cost extra capacity?',
          a: 'Briefly, yes: one or two extra pods for the length of the analysis. It is cheap compared with a bad promotion.',
        },
      ],
      pitfalls: [
        'Comparing canary against the service-wide average that includes the canary',
        'Fixed thresholds only',
        'No minimum sample size or no fail-closed on missing data',
      ],
    },
    {
      id: 'misc-ops-iq-12',
      difficulty: 'hard',
      question:
        'The new version of the search service passed a 5% canary for 30 minutes with clean metrics. An hour after reaching 100%, the whole service fell over. Give me the ways a canary misses bugs like this, and how you would change the release process.',
      whatInterviewerLooksFor: [
        'Lists several distinct classes of canary blind spot',
        'Links each to a concrete detection or process change',
        'Knows fleet-size-dependent effects (connections, downstream load, caches)',
        'Considers time-dependent failures and singleton workloads',
      ],
      modelAnswer: `### Why the canary missed it
1. **Time-based failures:** a memory leak or growing queue that takes 90 minutes to hit the limit. A 30-minute bake is too short.
2. **Fleet-size effects:** each new pod opens 50 DB connections instead of 10, or the new version calls a downstream 3× more often. At 5% the extra load is small; at 100% it saturates Postgres or the downstream.
3. **Shared-state effects:** a new cache key format. At 5%, 95% of traffic still reads and warms the old keys. At 100%, the hit rate collapses and the database takes the full read load (a cache stampede).
4. **Singleton work:** the leader-elected indexer or a cron runs on one pod that was not the canary, so the new code path never ran during the canary.
5. **Traffic selection bias:** sticky sessions or routing sent only new or anonymous sessions to the canary; heavy enterprise queries never hit it.
6. **Mixed-version compatibility:** the new version writes data the old version can read, but it breaks once no old readers remain (or the other way round).

### Process changes
- **Longer, staged ramp:** 1% → 5% → 25% → 50% → 100%, with each stage long enough for time-based effects (for example 30–60 minutes at 25–50%), and automatic analysis at every step.
- **Analyse saturation, not just errors:** DB connections, downstream call rate per request, cache hit ratio, memory growth slope. Compare canary against baseline *per pod* and extrapolate to the full fleet ("connections per pod × pods").
- **Load and soak tests** in pre-production for connection and memory behaviour at full fleet size.
- **Singleton and cron work** gets its own canary: run the new leader on the canary pod explicitly, or put the new job behind a flag.
- **Keep automatic rollback armed** for a few hours after 100%, with SLO burn-rate alerts tied to the rollout.`,
      followUps: [
        {
          q: 'How do you extrapolate a fleet-size effect from a 5% canary?',
          a: 'Measure resource use per pod or per request on the canary versus the baseline (for example DB connections per pod 50 vs 10), multiply by the full pod count, and compare with capacity limits such as max_connections, before promoting.',
        },
        {
          q: 'Rollback at 100% did not fix it. Why might that be?',
          a: 'The damage is in shared state: poisoned cache entries in the new format, a queue backlog, or migrated data. Rollback fixes code, not state, so you also need cache flushes, drain plans or backward-compatible data changes.',
        },
      ],
      pitfalls: [
        'Only saying "run the canary longer"',
        'Ignoring downstream or shared-resource amplification',
        'Assuming rollback always restores the previous state',
      ],
    },
    {
      id: 'misc-ops-iq-13',
      difficulty: 'medium',
      question:
        'Your team already has progressive canary deploys. A new engineer asks why you also need feature flags. What does each protect against, and when do you use both on the same change?',
      whatInterviewerLooksFor: [
        'Canary = the binary on a slice of pods; flag = behaviour for a slice of users',
        'Understands what cannot be canaried (data-dependent logic, specific tenants, long experiments)',
        'Mentions flag costs: combinatorics, stale flags, testing paths',
        'Gives a concrete combined example',
      ],
      modelAnswer: `### Different risks
| | Canary deploy | Feature flag |
|---|---|---|
| Unit of exposure | pods / traffic % | users, tenants, regions, % of users |
| Protects against | crashes, leaks, performance, config errors in the new binary | wrong logic, bad UX, business risk of the new behaviour |
| Speed of undo | minutes (redeploy or shift traffic) | seconds (toggle), no deploy |
| Duration | minutes to hours | days to weeks (experiments), or permanent (kill switch) |
| Targeting | random requests | "only internal staff", "only tenant X", "only India" |

### Why both
- A canary gives random requests to new pods. It cannot say "only beta tenants" or "keep the old price for 50% of users for two weeks to measure conversion".
- A flag cannot catch a memory leak or a crash at startup in the new binary, because the code is loaded on every pod regardless of the flag's value.

### Combined example: new pricing engine
1. Deploy the binary with the new engine **dark** (flag off). The canary proves the binary is healthy.
2. Turn the flag on for internal users, then 1% of users, then specific tenants, watching conversion and pricing errors.
3. Keep the flag as a kill switch until full rollout is stable, then delete the old path and the flag.

### The cost of flags
Every flag doubles the code paths to test. Stale flags accumulate. Evaluation needs a reliable flag service with safe defaults. So flags need owners and expiry dates.`,
      followUps: [
        {
          q: 'Can a flag replace a database migration strategy?',
          a: 'No. The schema must be compatible with both flag states (expand/contract). The flag switches reads and writes between old and new columns, and the migration itself still needs to be backward compatible.',
        },
        {
          q: 'What is a dark launch?',
          a: 'Running the new code path on real traffic without showing its results (for example compute the new price, log the difference, return the old price). It tests correctness and load before any user is affected.',
        },
      ],
      pitfalls: [
        'Saying flags make canaries unnecessary, or the reverse',
        'Ignoring that flag-off code is still deployed and can crash',
        'No lifecycle plan for flags',
      ],
    },
    {
      id: 'misc-ops-iq-14',
      difficulty: 'hard',
      question:
        'Design an internal feature-flag platform used by 300 services. The hottest services evaluate flags about 50K times per second per pod, product managers edit rules in a UI, and a change must reach every pod within 5 seconds. What does it look like, and what happens when the flag service is down?',
      whatInterviewerLooksFor: [
        'Local evaluation in the SDK; the network is not in the request path',
        'Push/streaming distribution with snapshots, versioning and ETags',
        'Deterministic bucketing, targeting rules, audit log and RBAC',
        'Failure modes: startup without the service, stale rules, safe defaults',
        'Governance: stale flags, change approval for kill switches',
      ],
      modelAnswer: `### Architecture
- **Control plane:** UI/API → flag store (Postgres) holding flags, rules, segments and environments. Every change is a new **version** with an audit record (who, what, why). RBAC plus approvals for production kill switches.
- **Distribution:** the store publishes a compiled ruleset per environment (JSON, a few hundred KB) to a CDN/S3 snapshot and to a streaming tier (SSE or gRPC streams via stateless relay nodes). A change is pushed as the new version number plus a diff, and it reaches pods in about 1 second.
- **SDK (in each service):** holds the ruleset in memory and **evaluates locally**. At 50K evaluations/s per pod, even a 1 ms network call is impossible; local evaluation is about 1–5 µs. The SDK receives streaming updates, falls back to polling the snapshot with an ETag every 30 s, and reports the version it is on.

### Evaluation semantics
- Targeting rules (tenant in list, country, app version) are evaluated in order, then a percentage rollout using **hash(flagKey + salt + userKey) mod 10,000**, so buckets are sticky per user and independent across flags.
- Every flag has a **code-level default** and a typed schema.

### Failure modes
- **Flag service down at runtime:** pods keep the last good ruleset. Staleness is fine for minutes to hours. Alert if the version lags.
- **Down at pod startup:** load the snapshot from CDN/S3 (a separate dependency) or a copy baked into the image or config map. As a last resort, use the code defaults. Never block startup forever.
- **Bad rule pushed** (for example 100% instead of 1%): versioned rollback in one click, change approval for high-risk flags, and staged propagation (canary environment first).

### Governance
Flag types with expiry dates, stale-flag reports ("100% on for 30 days"), code references found by a repository scan, and evaluation counts per flag for cleanup. Kill switches get tested every quarter.`,
      followUps: [
        {
          q: 'How do you keep flags consistent across a request that spans 5 services?',
          a: 'Either evaluate once at the edge and propagate the variants in baggage/headers, or make sure all services use the same user key and hash so they agree. Propagating is safer when the ruleset version can differ between pods.',
        },
        {
          q: 'How do you push to 20,000 pods without the relays falling over?',
          a: 'A relay tier fans out (each relay holds ~2K streams), changes are small diffs, clients reconnect with jitter, and clients that fall behind fetch the full snapshot from the CDN instead of the origin.',
        },
      ],
      pitfalls: [
        'Calling the flag service over HTTP on every evaluation',
        'Math.random() rollouts',
        'No behaviour defined for startup when the flag service is unreachable',
      ],
    },
    {
      id: 'misc-ops-iq-15',
      difficulty: 'medium',
      question:
        'Your service runs across three availability zones with a Multi-AZ database. The CTO says we are "highly available". What failures does this actually protect against, and which common outages does it not help with at all?',
      whatInterviewerLooksFor: [
        'Clear list of what AZ redundancy covers',
        'Names the larger classes it does not cover: deploys, config, region-level, data corruption, dependencies',
        'Mentions static stability and N−1 sizing',
        'Mentions hidden zonal single points (NAT, volumes, single-AZ caches)',
      ],
      modelAnswer: `### What Multi-AZ covers
- Loss of a datacentre or zone: power, cooling, network cut, a rack of hosts.
- DB primary host failure: synchronous standby in another AZ, RPO ≈ 0, failover in roughly 30–120 s.
- Only if it is **statically stable**: enough capacity in the remaining zones *without* launching anything new (N−1 sizing), and quorum systems spread 1-1-1 across three zones.

### Where it often quietly fails
- **Zonal single points:** a single NAT gateway, a single-AZ Redis, EBS-backed pods that cannot move zones, a license server on one VM.
- **Gray failures:** a zone with packet loss that still passes health checks. You need zonal shift or outlier detection.

### What it does not help with at all
- **Bad deploys and config pushes**, the most common cause of big outages. They roll out to every zone.
- **Regional failures:** control-plane APIs, regional DNS or service endpoints (the October 2025 DynamoDB us-east-1 DNS issue hit all zones).
- **Data corruption:** a bad migration or buggy writer is replicated synchronously to the standby in milliseconds.
- **Dependency outages:** the identity provider, payment provider or SaaS APIs.
- **Capacity/overload:** retry storms overwhelm all zones equally.

### So what should we say?
"We are resilient to a zone failure." Availability also needs progressive delivery, backups with point-in-time recovery, load shedding, dependency fallbacks and, for some tiers, multi-region.`,
      followUps: [
        {
          q: 'What does N−1 sizing cost with three zones?',
          a: 'Each zone must be able to carry 50% of peak (so losing one leaves 100%), meaning roughly 1.5× the minimum capacity. With two zones it is 2×, one reason three zones is the sweet spot.',
        },
        {
          q: 'Why not rely on the autoscaler to replace the lost zone?',
          a: 'During zone or regional events the control plane (instance launches, image pulls) is often slow or impaired, and everyone else is scaling at the same time. Static stability means the capacity is already running.',
        },
      ],
      pitfalls: [
        'Equating Multi-AZ with high availability in general',
        'Forgetting that deploys and data corruption cross zones',
        'Relying on autoscaling during the zone failure',
      ],
    },
    {
      id: 'misc-ops-iq-16',
      difficulty: 'hard',
      question:
        'After making every tier Multi-AZ, inter-AZ data transfer has grown to about 30% of the AWS bill. The finance team wants it halved this quarter. Where does that traffic come from, and how do you cut it without giving up zone resilience?',
      whatInterviewerLooksFor: [
        'Knows pricing: $0.01/GB each direction',
        'Finds the big sources: service-to-service calls, Kafka replication and consumers, DB replication, logging pipelines, cross-zone LB',
        'Uses topology-aware routing and fetch-from-follower',
        'Keeps failover behaviour: prefers the zone but does not pin to it',
        'Measures first (flow logs, per-service attribution)',
      ],
      modelAnswer: `### Measure first
Use VPC flow logs (or a network cost tool such as Kubecost) tagged by source and destination workload and AZ. At $0.01/GB in *each* direction, a service pair exchanging 100 TB/month across zones costs about $2,000/month. The bill is usually dominated by a handful of pairs.

### Usual big sources and fixes
1. **Service-to-service calls with random load balancing.** With 3 zones, about 2/3 of calls cross zones.
   - Kubernetes trafficDistribution: PreferClose / topology-aware routing, or zone-aware load balancing in the mesh (Istio locality LB, Envoy zone-aware routing). These keep calls in-zone while healthy endpoints exist there, and spill over when they do not. Resilience is kept.
   - Make sure each zone has enough replicas (topology spread) so the preference does not overload a zone.
2. **Kafka.** Producers write to leaders in other zones (unavoidable for the leader), replication to 2 followers crosses zones (the price of durability), and consumers read from leaders in other zones.
   - **Fetch-from-follower (KIP-392, client.rack)** lets consumers read from the in-zone replica. For fan-out topics with many consumer groups this is often the single biggest saving.
   - Compress producer batches (zstd or lz4, often 3–5× smaller).
3. **Load balancers:** cross-zone load balancing on NLBs is charged for data. Turn it off where targets are balanced per zone.
4. **Chatty payloads:** big JSON between services → gzip or protobuf, and trim fields.
5. **Observability pipelines:** agents shipping logs to a collector in another zone. Use a zone-local collector tier and compress.

### What not to cut
Synchronous DB standby replication and Kafka replicas across zones: that is the resilience you are paying for. Budget for it explicitly.

### Expected result
Topology-aware routing (≈2/3 → ≈10% cross-zone for calls) plus fetch-from-follower and compression often cuts inter-AZ spend by 50–70%.`,
      followUps: [
        {
          q: 'Zone-aware routing sent all traffic in zone A to 2 pods there while zone B had 10. What went wrong?',
          a: 'Replicas were not spread evenly. Topology-aware hints require balanced endpoints per zone, so add topologySpreadConstraints and scale per zone. Otherwise the zone preference overloads the small zone.',
        },
        {
          q: 'Does keeping traffic in-zone reduce resilience?',
          a: 'Not if it is a preference with spill-over. If a zone\'s endpoints are unhealthy or missing, traffic goes to other zones. Pinning without fallback would reduce resilience.',
        },
      ],
      pitfalls: [
        'Collapsing everything into one AZ to save money',
        'Not knowing that both directions are billed',
        'Optimising without per-service attribution',
      ],
    },
    {
      id: 'misc-ops-iq-17',
      difficulty: 'medium',
      question:
        'Leadership wants a second region "for reliability". Can adding a region make the product less reliable? Give concrete ways it goes wrong and what makes it worth it.',
      whatInterviewerLooksFor: [
        'Understands complexity and correlated-dependency risk',
        'Knows that failover mechanisms themselves fail, and that failover is often untested',
        'Knows that data consistency and split-brain are new failure modes',
        'Gives conditions for it to pay off',
      ],
      modelAnswer: `### Yes, it can
1. **New failure modes:** cross-region replication lag, write conflicts, split-brain after a false failover. These did not exist with one region.
2. **Untested failover:** a warm standby that has not taken real traffic for months fails when needed (expired certificates, missing secrets, config drift, too little capacity).
3. **False-positive failovers:** an automated failover triggered by a monitoring blip causes a bigger outage than the blip.
4. **Hidden single-region dependencies:** auth, secrets, CI/CD, registries or "global" control planes that live in the primary region. Two regions, one point of failure.
5. **Coupling:** synchronous cross-region calls (for example a global lock or a sync write) mean either region's problems hurt both. Availability can drop below one region's.
6. **Change risk doubles:** more config, more deploy targets, more for engineers to understand at 3 a.m.

### What makes it worth it
- Regions are **independent**: no synchronous cross-region calls in the request path, and each region has its own dependencies.
- Failover is a **routine operation**, practised regularly (some teams move traffic weekly), and uses data-plane mechanisms.
- **Explicit data model:** which data is single-homed, which is replicated, and which RPO applies.
- Business need: the regional-outage cost justifies roughly 1.5–2× infrastructure plus the engineering time. Latency for distant users or residency law can also justify it.

### Cheaper alternatives first
Multi-AZ done well, progressive delivery, backups with PITR, and cell-based isolation often buy more reliability per rupee than a second region.`,
      followUps: [
        {
          q: 'How often should you fail over for real?',
          a: 'Often enough that it is boring: at least quarterly, ideally monthly, with production traffic. Rotating primaries on a schedule is the strongest proof.',
        },
        {
          q: 'What is a good first step to multi-region?',
          a: 'Backups and infrastructure-as-code restorable in the second region (pilot light), then read-only traffic served from it, then a warm standby with regular failover drills.',
        },
      ],
      pitfalls: [
        'Assuming two regions automatically halve downtime',
        'Synchronous cross-region calls in the hot path',
        'Automated failover with no quorum or hysteresis',
      ],
    },
    {
      id: 'misc-ops-iq-18',
      difficulty: 'expert',
      question:
        'On 20 October 2025, DynamoDB in us-east-1 became unreachable for hours after an automation race left its regional DNS record empty. Your company "runs in two regions", yet you were down for most of it. Walk me through the audit you would run afterwards and the redesign you would propose.',
      context:
        'Based on AWS\'s public post-event summary: an empty DNS record for dynamodb.us-east-1.amazonaws.com, followed by knock-on EC2 launch and NLB problems that extended the impact.',
      whatInterviewerLooksFor: [
        'Systematic dependency audit, including indirect and control-plane dependencies',
        'Distinguishes data-plane from control-plane operations during failover',
        'Addresses capacity in the second region when launches are impaired',
        'Covers people and process: access, runbooks, decision authority',
        'Concrete test to prove the redesign',
      ],
      modelAnswer: `### The audit: why were we down?
Go through the timeline and ask, for each component, *"what did this need from us-east-1?"*
1. **Direct data dependencies:** sessions, idempotency keys or config in a DynamoDB table in us-east-1 only (not a global table).
2. **Indirect dependencies:** the auth service, feature-flag service, or secrets fetched at startup from us-east-1. Lambda or queue-based jobs in the region.
3. **Control-plane dependencies during failover:** our runbook changed Route 53 records via API (the Route 53 control plane is in us-east-1), scaled the DR region with Auto Scaling (EC2 launches were impaired), and pulled images from a registry in us-east-1.
4. **Capacity:** the DR region ran at 20% capacity, expecting to scale up at failover. Many companies were trying to scale up in other regions at the same time.
5. **People:** SSO or the VPN was hosted in us-east-1; the runbook lived in a wiki in the same region; no one had clear authority to call the failover.

### Redesign
- **Statically stable second region:** runs enough capacity to take 100% (or a planned degraded mode, for example 60% with non-critical features shed) *without* launching anything.
- **Data-plane-only failover:** health-check-driven DNS failover or pre-created routing controls (Route 53 Application Recovery Controller data plane), TTL of 30–60 s. No record edits during the event.
- **Per-region dependencies:** DynamoDB global tables or per-region stores for sessions and config. Flags and secrets cached locally with a last-known-good fallback. Images replicated to each region's registry.
- **Fallbacks:** if the flag or config store is unreachable, use cached values. If a non-critical table is unreachable, degrade the feature instead of failing the request.
- **Break-glass access** and runbooks outside the region. Named incident commanders with authority to fail over within 15 minutes.

### Prove it
A quarterly game day that blocks all us-east-1 endpoints (DNS and network deny) from the DR region's workloads and runs full traffic there for an hour. The RTO we report is the one measured on that day.`,
      followUps: [
        {
          q: 'Why is a DNS-level failure especially nasty for clients?',
          a: 'Clients cache results (including negative results) and SDKs retry, so recovery lags the fix. Retries on reconnect can then form a thundering herd. You need jittered backoff and connection limits in clients.',
        },
        {
          q: 'Is active-active the answer to everything here?',
          a: 'It removes the "cold standby does not work" problem and makes failover routine, but it adds conflict handling. For most tiers, a warm, statically stable standby with regular failovers is enough.',
        },
      ],
      pitfalls: [
        'Only checking direct data dependencies, not control planes and startup dependencies',
        'Planning to scale up the DR region during a regional event',
        'Assuming DNS failover works without testing TTLs and client caching',
      ],
    },
    {
      id: 'misc-ops-iq-19',
      difficulty: 'medium',
      question:
        'Your DR plan is a hot standby database in another region with streaming replication. How does that plan help if a buggy deploy corrupts 20% of order rows, or ransomware encrypts your data? What would you add?',
      whatInterviewerLooksFor: [
        'Knows that replication copies corruption and deletion instantly',
        'Knows PITR, delayed replicas and immutable/isolated backups',
        'Considers credential isolation (separate account, Object Lock)',
        'Mentions detection time as part of the RPO',
      ],
      modelAnswer: `### It does not help
Replication is built to copy every change faithfully and quickly. A corrupting UPDATE or a mass DELETE arrives on the standby within milliseconds. Ransomware with our credentials can encrypt or delete the primary, the replica *and* backups in the same account. Replication covers **infrastructure loss**, not **logical damage**.

### What to add
1. **Point-in-time recovery:** base backups plus continuous WAL archiving, so we can restore to "10:41:59, just before the bad deploy". The retention must be longer than the time it takes to *notice* corruption (often days).
2. **A delayed replica** (for example recovery_min_apply_delay = 1h): a fast way to recover recent damage without a full restore, if noticed within the delay.
3. **Immutable, isolated backups:** copy to a **separate account** with separate credentials, and use S3 Object Lock in compliance mode (it cannot be deleted even by root until retention ends). Encryption keys must not be deletable by the production account.
4. **Logical repair tooling:** most corruption is partial. Restore a PITR copy to a side instance, then diff and patch the affected rows (with audit logs and event history), instead of rolling back the whole database and losing good writes.
5. **Detection:** data-quality checks and reconciliation jobs (order totals match line items, counts per day look normal). The RPO for corruption depends on how fast you notice.

### Then practise
Restore drills that measure the time for a full restore and for a partial "repair 20% of rows" playbook.`,
      followUps: [
        {
          q: 'Why not just restore the whole database to before the bad deploy?',
          a: 'You would lose every good write since then (hours of orders). A side restore plus a targeted patch of only the damaged rows keeps the good data. Full rollback is a last resort.',
        },
        {
          q: 'How long should backups be retained?',
          a: 'Longer than the worst plausible detection delay plus compliance requirements. For ransomware, attackers often wait weeks, so 30–90 days of immutable copies is common.',
        },
      ],
      pitfalls: [
        'Saying "we have a replica, so we are covered"',
        'Backups in the same account with the same credentials',
        'Ignoring detection time in the RPO',
      ],
    },
    {
      id: 'misc-ops-iq-20',
      difficulty: 'hard',
      question:
        'The auditors want evidence that your 1-hour RTO is real. How do you run a disaster-recovery drill on production systems without hurting customers, and what do you measure?',
      whatInterviewerLooksFor: [
        'Staged approach from tabletop to real failover',
        'Safety controls: abort criteria, blast-radius limits, timing, communication',
        'Measures RTO and RPO as actually achieved, per step',
        'Turns findings into tracked fixes and repeats',
      ],
      modelAnswer: `### Build up in stages
1. **Tabletop:** walk through the runbook with the on-call team. Find missing access, unclear owners and steps that depend on the failed region.
2. **Restore drill (no customer impact):** restore the latest backup plus WAL into an isolated environment, run checksums and application smoke tests, and time each phase (download, restore, WAL replay, validation).
3. **Component failover in production:** fail over one stateless service's traffic to the DR region at low traffic, then the database replica promotion using a controlled switchover (zero data loss, because writes are paused and the replica catches up first).
4. **Full region evacuation game day:** move all traffic to the DR region for an hour or more during a low-traffic window, with customers informed only if required.

### Safety controls
- Clear abort criteria (for example error-rate SLO burn above 6×, or checkout errors above 1%) and a tested way back.
- Do it during business hours with everyone present, not at 3 a.m.
- Freeze other changes, notify support, and prepare a status-page note.
- Start with a percentage of traffic via weighted routing (10% → 50% → 100%).

### What to measure
- **RTO per step:** detection → decision → database promotion → traffic shift → error rate back to normal. The number you report is the end-to-end time.
- **RPO achieved:** replica lag at the moment of switchover, and whether any writes were lost or conflicted.
- **Capacity:** could the DR region handle 100% without scaling?
- **Surprises:** every manual step, missing permission and hidden dependency becomes a ticket with an owner.

### Evidence for auditors
Timestamped runbook logs, dashboards, the measured RTO/RPO compared with targets, and the list of fixes and their completion. Repeat at least twice a year, and after major architecture changes.`,
      followUps: [
        {
          q: 'Controlled switchover is safe, but real disasters are not controlled. Is the drill realistic?',
          a: 'Partly. Also run unplanned-style drills: cut the network to the primary (or block its endpoints) and fail over without the old primary\'s cooperation. That tests fencing and data-loss handling, preferably in staging first.',
        },
        {
          q: 'What usually breaks in the first real drill?',
          a: 'Expired certificates or secrets in the DR region, missing IAM permissions, hardcoded region endpoints, too little capacity or quota, and DNS TTLs longer than anyone thought.',
        },
      ],
      pitfalls: [
        'Reporting the RTO from the design doc instead of a measured drill',
        'Drills with no abort criteria',
        'Only testing backups, never traffic failover',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'misc-ops-boe-1',
      question:
        'Checkout has a 99.9% availability SLO over 30 days and serves 50M requests/day. A bad config makes 2% of requests fail from 09:00. When does the 14.4× / 1h page fire, how much budget is gone by then, and how would the answer change for a full outage?',
      assumptions: [
        'Error ratio before 09:00 is ~0; it jumps to exactly 2% and stays there',
        'Page rule: 1h burn rate > 14.4 AND 5m burn rate > 14.4 (threshold 14.4 × 0.1% = 1.44%)',
        'Traffic flat at the daily average',
      ],
      steps: [
        { label: 'Monthly budget', calc: '50M × 30 = 1.5B requests × 0.1% = 1.5M failed requests allowed' },
        { label: 'Burn rate', calc: '2% ÷ 0.1% = 20× → the whole budget is gone in 30 d ÷ 20 = 1.5 days (36 h)' },
        { label: 'Short window', calc: '5m average reaches 1.44% after 0.72 × 5 min ≈ 3.6 min' },
        { label: 'Long window', calc: '1h average = 2% × t/60 > 1.44% → t > 43.2 min → pages at ~09:43' },
        { label: 'Budget spent at page', calc: '578 req/s × 2,592 s ≈ 1.5M requests × 2% ≈ 30K failures = 2% of budget' },
        { label: 'Full outage (100% errors)', calc: '1h average > 1.44% after 0.0144 × 60 min ≈ 52 s → page in under a minute' },
      ],
      answer:
        'The page fires about 43 minutes after the start (09:43), having spent ~30K failures, about 2% of the monthly budget. A complete outage would page in about 52 seconds. The 6×/6h rule would need 1.8 h for this 2% error rate.',
      insight:
        'Detection time for a burn-rate alert is (window × threshold × budget) ÷ error rate, so it adapts to severity: full outages page in under a minute, and small leaks page later but before they matter. If 43 minutes of 2% checkout failures is too long for the business, add a higher-threshold tier (for example 36× over 15m) instead of alerting on raw 5xx.',
      followUps: [
        {
          "q": "The business says 2% checkout failures for 43 minutes is unacceptable and wants a page within 10 minutes. Which tier do you add, and what's the noise cost?",
          "a": "To page within 10 minutes at a 20× burn, the window × threshold must be met in 10 minutes. A 15-minute window with a threshold that 2% exceeds after 10 minutes: average after 10 minutes = 2% × 10/15 = 1.33%, so a threshold of about 13× (1.3%) works, paired with a 1–2 minute short window. Budget consumed before paging is about 0.5%. Noise cost: shorter windows react to brief spikes (a 3-minute 10% blip also crosses the threshold), so expect more short pages. Add a minimum request count and a short-window AND clause, and review page volume after a month."
        }
      ],
    },
    {
      id: 'misc-ops-boe-2',
      question:
        'Estimate monthly inter-AZ data transfer cost for a platform spread across 3 AZs, and how much zone-aware routing and Kafka fetch-from-follower would save.',
      assumptions: [
        '30K edge RPS on average; each request triggers 8 internal RPCs averaging 3 KB (request + response)',
        'Random load balancing across 3 AZs, so ~2/3 of calls cross a zone',
        'Kafka: 50 MB/s produced, replication factor 3 across 3 AZs, 4 consumer groups reading everything',
        'Inter-AZ price $0.01/GB out + $0.01/GB in = $0.02/GB crossing; 1 month ≈ 2.6M s',
      ],
      steps: [
        { label: 'RPC bytes', calc: '30K × 8 × 3 KB = 720 MB/s × 2.6M s ≈ 1,870 TB/month' },
        { label: 'RPC cross-AZ', calc: '2/3 × 1,870 TB ≈ 1,250 TB × $0.02/GB ≈ $25K/month' },
        { label: 'Kafka produce + replication', calc: 'produce to leader 2/3 × 50 = 33 MB/s; 2 follower copies = 100 MB/s → 133 MB/s' },
        { label: 'Kafka consumers', calc: '4 groups × 50 MB/s × 2/3 ≈ 133 MB/s' },
        { label: 'Kafka total', calc: '266 MB/s × 2.6M s ≈ 690 TB × $0.02/GB ≈ $13.8K/month' },
        { label: 'After fixes', calc: 'zone-aware RPCs → ~10% cross: ≈ $3.7K; fetch-from-follower removes consumer cross-AZ ≈ −$6.9K' },
        { label: 'Total', calc: 'before ≈ $39K/month → after ≈ $3.7K + $6.9K ≈ $10.6K/month' },
      ],
      answer:
        'About $39K/month before (≈ $25K RPC, ≈ $14K Kafka), and about $11K/month after zone-aware routing plus fetch-from-follower, a ~70% reduction. The remaining cost is mostly Kafka replication, which is the durability you are paying for.',
      insight:
        'Inter-AZ cost is proportional to fan-out × payload × cross-zone fraction. The cheapest levers keep traffic zone-local as a preference (with spill-over), compress payloads, and read from local replicas. Never remove cross-AZ replication to save money; budget for it explicitly.',
      followUps: [
        {
          "q": "Zone-aware routing is enabled, but one AZ has 50% of the pods for a service and receives only 33% of traffic. What happens, and how does topology-aware routing handle it?",
          "a": "Strict zone-local routing sends each zone's traffic only to local pods, so zones with fewer pods (relative to their traffic) get overloaded while the heavy zone idles. Kubernetes Topology Aware Routing only enables hints when endpoints are roughly proportional to each zone's CPU capacity, and otherwise falls back to cluster-wide routing. Envoy-style zone-aware routing spills a proportional share across zones when local capacity is insufficient. Fix the cause too: use `topologySpreadConstraints` to spread pods evenly across zones, and keep traffic per zone balanced at the LB."
        }
      ],
    },
    {
      id: 'misc-ops-boe-3',
      question:
        'The checkout canary gets 5% of 400 RPS by day and 5% of 40 RPS at night. The baseline error ratio is 0.2%. How long must the canary run to reliably detect a doubling of errors, and what about a 20% increase?',
      assumptions: [
        'Two-sample comparison: canary vs a same-size baseline, one-sided α = 0.05 (z = 1.645), power 80% (z = 0.84)',
        'n per arm ≈ (z_α·√(2p̄(1−p̄)) + z_β·√(p₀(1−p₀)+p₁(1−p₁)))² ÷ (p₁−p₀)²',
        'Canary and baseline each get 5% of traffic',
      ],
      steps: [
        { label: 'Doubling (0.2% → 0.4%)', calc: 'p̄ = 0.3%: (1.645 × 0.0773 + 0.84 × 0.0773)² ÷ 0.002² ≈ 0.0369 ÷ 4×10⁻⁶ ≈ 9,200 requests per arm' },
        { label: 'Daytime duration', calc: '5% × 400 = 20 RPS → 9,200 ÷ 20 ≈ 460 s ≈ 8 min' },
        { label: 'Night duration', calc: '5% × 40 = 2 RPS → 9,200 ÷ 2 ≈ 4,600 s ≈ 77 min' },
        { label: '20% increase (0.2% → 0.24%)', calc: 'Δ is 5× smaller → n ≈ 25× larger ≈ 230K per arm → ≈ 3.2 h by day' },
      ],
      answer:
        'About 9K requests per arm: ~8 minutes by day, ~77 minutes at night, to catch a doubling. A 20% regression needs ~230K requests per arm (hours), so a canary cannot practically catch it.',
      insight:
        'A canary catches large regressions quickly; small ones need a longer, higher-weight ramp, an experiment behind a feature flag, or SLO burn-rate alerts after rollout. Gate promotion on a minimum sample count, not wall-clock minutes, and avoid night deploys when traffic is thin.',
      followUps: [
        {
          "q": "Instead of a fixed 5%, how would you design a canary that detects a doubling faster without risking more users?",
          "a": "Keep user exposure low and gather evidence faster with more signal per request. Use the response path: shadow traffic mirrors a large share (say 50%) of read requests to the canary without serving its responses, giving ~10× samples at zero user risk, but only for idempotent reads. Use leading indicators: new exception types in logs, panics, or per-endpoint error rates, which can show up within hundreds of requests. Use a sequential test (like SPRT) rather than a fixed sample size, which stops early when the evidence is strong. Run the canary during peak hours."
        }
      ],
    },
    {
      id: 'misc-ops-boe-4',
      question:
        'Your API needs 120 pods (1 vCPU each) at peak. Estimate the realistic RTO of a regional failover for pilot light (0 app pods running in DR), warm standby at 25%, and a statically stable standby at 100%, and the monthly standby compute cost of each.',
      assumptions: [
        'Nodes: 16 vCPU, ~14 usable for pods → ~9 nodes for 120 pods; ~$0.80/hour per node',
        'Detection + human decision: 10 min. Node provisioning 4 min (if capacity and quota exist), image pull + boot + warm-up 3 min',
        'DB replica promotion 2 min (in parallel). DNS TTL 60 s, but ~5 min before most clients move',
        'During a regional event, other companies are also scaling in the DR region',
      ],
      steps: [
        { label: 'Pilot light', calc: '10 (decide) + 4 (nodes) + 3 (pods) + 5 (DNS/clients) ≈ 22 min, if launches succeed; often 45+ min under contention' },
        { label: 'Warm 25%', calc: '30 pods absorb traffic after 10 + 5 ≈ 15 min, but shed ~75% of load until scale-up finishes (≈ 22 min)' },
        { label: 'Statically stable 100%', calc: '10 (decide) + 5 (DNS/clients) ≈ 15 min, no launches needed; with automated decision ≈ 6–8 min' },
        { label: 'Cost: 100%', calc: '9 nodes × $0.80 × 730 h ≈ $5.3K/month' },
        { label: 'Cost: 25% and pilot light', calc: '≈ 3 nodes ≈ $1.8K/month; pilot light ≈ $0 compute (DB replica only)' },
      ],
      answer:
        'Pilot light ≈ 22 min on paper and 45+ min in a real regional event. Warm 25% serves some traffic by ~15 min and all by ~22. A statically stable standby ≈ 15 min (≈ 7 with automated decisions) for about $5K/month of idle compute.',
      insight:
        'Most of the RTO is the human decision and DNS/client movement, not the infrastructure. The scale-up step is the least reliable during a real regional event, so critical tiers justify static stability, while non-critical tiers can use pilot light. Shortening decision time (clear authority, pre-approved triggers) is the cheapest RTO win.',
      followUps: [
        {
          "q": "The CFO wants to cut the $5K/month standby cost. Which parts of the 100% standby can you trim while keeping a ~15-minute RTO?",
          "a": "Keep what's slow or unreliable to create during an event: the database replica (it must be warm), networking, load balancers, certificates, IAM, and secrets, all pre-provisioned. Trim compute with capacity reservations instead of running nodes: on-demand capacity reservations guarantee the instances exist when you launch them (cost similar to running them, but savings plans can apply). Or run the standby at about 50% and accept degraded service with load shedding for the first 10 minutes while autoscaling adds the rest. Or put DR to work: run some non-critical or read traffic there in steady state, so the capacity isn't idle."
        }
      ],
    },
  ],
  test: [
    {
      id: 'misc-ops-mcq-01',
      difficulty: 'hard',
      question:
        'The order-details GraphQL resolver below serves orders with up to 50 line items. The catalog service has p50 = 4 ms and p99 = 40 ms. Order pages take 200–400 ms and occasionally 2 s. What is the root cause and the best fix?',
      code: {
        language: 'typescript',
        code: `@ResolveField(() => [LineItemView])
async items(@Parent() order: Order) {
  const views: LineItemView[] = [];
  for (const item of order.items) {
    // one HTTP call to catalog-service per line item
    const product = await this.catalog.getProduct(item.productId);
    views.push({ ...item, name: product.name, image: product.imageUrl });
  }
  return views;
}`,
      },
      options: [
        'The catalog HTTP agent needs a larger socket pool; raising maxSockets will parallelise these calls automatically',
        'The catalog service is under-provisioned; scaling it out will bring p50 and p99 down enough to fix the page',
        'Add retries with a 10 ms timeout per getProduct call so slow calls are cut short and retried quickly',
        'N sequential network round trips: 50 × ~4 ms, and 50 chances to hit the 40 ms tail. Batch them (DataLoader plus a getProducts(ids[]) endpoint) so there is one call per request',
      ],
      correct: [3],
      explanation:
        'Each await runs after the previous one, so latency ≈ 50 × p50 plus the tail: with 50 calls, 1 − 0.99^50 ≈ 40% of pages include at least one p99-slow call. Batching into one getProducts call removes both problems. A bigger socket pool does nothing for sequential awaits. Scaling catalog does not change the number of round trips. Aggressive retries with tiny timeouts amplify load and still pay per-call overhead.',
      followUps: [
        {
          "q": "The catalog team says a batch endpoint is two sprints away. What can you do today on the resolver side, and what does it cost?",
          "a": "Run the 50 calls concurrently with a bounded limit, say 10 at a time (`p-limit`), instead of sequentially. Latency drops from about 50 × 4 ms to roughly 5 waves × 4 ms plus the slowest tail, around 20–60 ms. Costs: 10× more concurrent load on catalog per page, more sockets (keep-alive agent with maxSockets sized for it), and the tail problem remains: each page still makes 50 calls, so about 40% of pages wait for at least one p99. Add a short per-call timeout with a placeholder ('product details unavailable'), and cache products in-process for 30–60 s, since catalog data changes slowly."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-02',
      difficulty: 'medium',
      question:
        'An architect proposes extracting "Notifications" (email, SMS, push) out of the NestJS monolith into its own service. Which facts argue FOR the extraction? Select ALL that apply.',
      options: [
        'Its load spikes about 50× during marketing campaigns while the rest of the app is flat',
        'A separate team owns it and wants to release daily, independent of the monolith\'s weekly train',
        'It must update the orders row in the same database transaction that places the order',
        'Its interface is naturally asynchronous: other modules fire events and never wait for the result',
        'Checkout calls it synchronously five times per request to render confirmation templates',
      ],
      correct: [0, 1, 3],
      explanation:
        'Different scaling profiles, separate ownership and release cadence, and an async event interface are the classic signs of a good boundary: the service can scale, deploy and fail independently. Sharing a transaction with orders means the boundary would cut through a consistency requirement, forcing a saga or outbox. Five synchronous calls per checkout make it chatty and put it on the critical path, which is an argument against a network boundary there.',
      followUps: [
        {
          "q": "You extract Notifications. During a campaign it falls 2 hours behind. What should the rest of the system experience, and how do you prioritise?",
          "a": "Nothing synchronous should slow down: other modules publish events and move on, and the backlog sits in the queue. But transactional messages (OTPs, order confirmations) must not wait behind 5M marketing emails. Split into priority lanes: separate topics or queues for transactional and bulk, each with its own consumers and provider rate-limit budget. OTPs might have a 30 s SLO, marketing a 6-hour one. Drop or expire time-sensitive messages that are too old to be useful (an OTP after 10 minutes). Monitor queue age per lane, not just depth."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-03',
      difficulty: 'hard',
      question:
        'To cut log cost, a team adds this sampler in front of their log shipper. Select ALL real problems.',
      code: {
        language: 'typescript',
        code: `export function ship(entry: LogEntry) {
  // keep 1% of logs to control cost
  if (Math.random() > 0.01) return;

  // never lose the important ones
  if (entry.level === 'error' || entry.durationMs > 1000) {
    entry.priority = 'high';
  }
  sink.write(entry);
}`,
      },
      options: [
        'Errors and slow requests are dropped 99% of the time, because the random decision happens before the entry is classified',
        'Each line is sampled independently, so a kept request usually has only some of its lines; sampling should be decided per trace_id (for example a hash of it)',
        'Math.random() is not cryptographically secure, so the kept sample is biased toward certain users',
        'Sampling must only ever be done in the collector; any sampling in the application is incorrect',
      ],
      correct: [0, 1],
      explanation:
        'The early return runs before the error/slow check, so the "important" logs are lost like everything else. Independent per-line sampling breaks request coherence; hashing the trace_id keeps or drops all lines of a request together and aligns with trace sampling. Math.random is fine for statistical sampling (no security property is needed). Application-side sampling is legitimate and often cheaper; the collector is not the only valid place.',
      followUps: [
        {
          "q": "Write the corrected sampling decision, and say how you keep error logs from requests that the trace sampler dropped.",
          "a": "Classify first: always keep level ≥ warn or `duration_ms > slowThreshold`. Otherwise keep if `hash(trace_id) % 100 < 1`, so all lines of a sampled request are kept together. But the 'slow' or 'error' outcome is often known only at the end of the request, after earlier lines were dropped. Fix that with tail-based handling: buffer a request's debug and info lines in memory (bounded, say 200 lines) and flush them all if the request ends in an error or is slow; otherwise apply the hash sample. The OpenTelemetry Collector's tail sampling processor does the same for traces."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-04',
      difficulty: 'medium',
      question:
        'You need to debug problems for individual tenants (40K tenants, 3 tiers). Where should tenant information go? Select ALL that apply.',
      options: [
        'tenant_id as an attribute on the root span of each request',
        'tenant_id as a field in structured JSON log lines',
        'tenant_id as a label on the request-duration histogram',
        'tenant_tier (free / pro / enterprise) as a label on the request-duration histogram',
        'tenant_id as a Loki stream label so queries per tenant are fast',
      ],
      correct: [0, 1, 3],
      explanation:
        'Spans and log fields can carry unbounded values because they are sampled events, not time series. tenant_tier has 3 values, so as a metric label it multiplies series only 3×. tenant_id on a histogram creates 40K × buckets × other labels series (millions). As a Loki stream label it creates 40K streams per service and destroys ingestion and indexing. Filter on it as a log field instead.',
      followUps: [
        {
          "q": "An enterprise tenant complains their p99 is bad, but the tier-level metric looks fine. How do you investigate without adding tenant_id to metrics?",
          "a": "Use high-cardinality event data. Query traces by `tenant_id` attribute in Tempo, Honeycomb or Jaeger to get that tenant's latency distribution and slowest traces, or compute it from structured logs (Loki: filter on the JSON field `tenant_id`, then `quantile_over_time`). Look for what differs: request shapes (large orders, many items), a hot shard their data lives on, a specific endpoint. For tenants with contractual SLAs, add a small allow-list of 'tracked tenants' (say 20) as a metric label, so cardinality stays bounded."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-05',
      difficulty: 'expert',
      question:
        'In a trace, the child span "inventory.reserve" (recorded on host B) starts 38 ms before its parent "POST /checkout" (recorded on host A) and ends before the parent starts. Both services are healthy. What is the most likely explanation?',
      options: [
        'The context was propagated incorrectly, and inventory created a new root span that happens to share the trace ID',
        'The inventory call was made asynchronously before the checkout handler started, so the order is real',
        'Clock skew between hosts A and B: each span uses its own host\'s clock, so cross-host timings are only as accurate as NTP sync',
        'The tracing backend reorders spans by span ID, which randomises their displayed start times',
      ],
      correct: [2],
      explanation:
        'Span timestamps come from the clock of the host that records them. A few ms to tens of ms of skew between hosts can make a child appear to start before its parent, and some UIs apply skew adjustment for this reason. Durations measured within one host remain reliable. Broken propagation would produce a separate root, not a child with a parent reference. A child cannot causally precede the request that triggered it, and backends do not order spans by span ID.',
      followUps: [
        {
          "q": "How would you measure the actual clock skew across your fleet, and what bound is acceptable for tracing?",
          "a": "Export each node's NTP or chrony offset as a metric (`chronyc tracking` or node_exporter's `node_timex_offset_seconds`) and alert above a threshold. On AWS, Amazon Time Sync gives sub-millisecond accuracy, and newer instances support microsecond-level PTP. For tracing, skew well below typical cross-service span durations (a few milliseconds) is fine. Above 10 ms, waterfall views start to mislead. Use span durations (measured on one host) for performance analysis, and treat cross-host start offsets as approximate. Some backends adjust skew using the parent-child relationship."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-06',
      difficulty: 'expert',
      question:
        'A load test uses the harness below against an API that pauses for 2 s every 10 s (a GC stall). The report shows p99 ≈ 45 ms and max = 2 s. What is wrong with the measurement?',
      code: {
        language: 'typescript',
        code: `// 50 virtual users, closed loop: send, wait, record, repeat
const latencies: number[] = [];
for (let vu = 0; vu < 50; vu++) {
  (async () => {
    while (running) {
      const t0 = performance.now();
      await fetch(url);
      latencies.push(performance.now() - t0);
    }
  })();
}`,
      },
      options: [
        'Coordinated omission: during the stall each virtual user waits and records one slow sample, instead of the ~200 requests per user that should have been sent and delayed. The tail is massively under-reported; use a constant-arrival-rate (open-loop) generator and measure from the intended send time',
        'performance.now() has millisecond resolution in Node, which rounds sub-millisecond latencies and skews p99 downwards',
        'Fifty virtual users are too few to saturate the API, so the 2 s stall never shows up in the percentile calculation',
        'The array grows without bound, and garbage collection in the load generator itself adds the 2 s pauses to the measurements',
      ],
      correct: [0],
      explanation:
        'A closed-loop tester slows down when the system slows down, so bad periods are sampled far less than good ones. In the 2 s stall, 50 users record 50 slow samples, while an open-loop client at ~100 req/s per user would have seen ~10,000 delayed requests, which would put p99 well above 1 s. performance.now() has sub-ms resolution. Saturation is not the issue, because the stall is intrinsic. The array could cost memory, but it does not explain the missing tail.',
      followUps: [
        {
          "q": "Rewrite the load test correctly. What parameters do you choose, and what will the report look like now?",
          "a": "Use an open-loop generator: k6 `constant-arrival-rate` executor at the target rate (say 5,000 req/s) with enough preallocated VUs to sustain it, or wrk2 with `-R`. Measure latency from the scheduled send time, which wrk2 and k6's arrival-rate executor do, so requests queued during the stall carry their waiting time. Expect p99 to show the stall: 20% of each 10 s is stalled, so requests scheduled in that window wait up to 2 s, putting p90 and p99 in the hundreds to thousands of milliseconds. Also report the latency distribution over time (HdrHistogram), so the periodic stall is visible."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-07',
      difficulty: 'hard',
      question:
        'You only have per-pod latency data for 12 pods and need a fleet-wide p99. Which approaches give a valid result or a valid bound? Select ALL that apply.',
      options: [
        'Sum the histogram bucket rates across pods by le, then apply histogram_quantile(0.99, …)',
        'Merge the per-pod t-digest or HDR histogram sketches, then read the 99th percentile from the merged sketch',
        'Average the per-pod summary p99 values, weighted by each pod\'s request count',
        'Take the maximum of the per-pod p99 values as a conservative upper bound on the fleet p99',
        'Take the median of the per-pod p99 values as an unbiased estimate of the fleet p99',
      ],
      correct: [0, 1, 3],
      explanation:
        'Histograms and sketches like t-digest and HDR are mergeable: combine the distributions, then compute the quantile. The max works as a bound: if every pod has at most 1% of requests above X, the whole fleet has at most 1% above X, so fleet p99 ≤ max(p99). Weighted averages and medians of percentiles are still averages of positions, and they can be far from the truth when one pod has a heavy tail.',
      followUps: [
        {
          "q": "Your pods export summaries, not histograms, and you can't redeploy all 12 today. What can you honestly report for the fleet p99?",
          "a": "Report the bound: fleet p99 ≤ max of per-pod p99s, and clearly label it as an upper bound. Also report each pod's p99 with its request share, which often shows that one pod is the outlier (bad node, noisy neighbour) and is actionable on its own. Don't report an average of p99s as 'fleet p99'. Then plan the fix: switch to histograms with buckets around the SLO threshold (or native histograms), so the next report is a true merged quantile."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-08',
      difficulty: 'hard',
      question:
        'An internal admin API receives about 200 requests per 5 minutes. The alert "p99 > 1 s for 5 minutes" fires and resolves several times a day, and nobody finds anything wrong. What is the best change?',
      options: [
        'Reduce the evaluation interval to 30 s so the alert reacts faster and resolves more cleanly',
        'Switch the histogram to a summary so the p99 is computed exactly on each pod',
        'Increase the replicas so each pod serves fewer requests and its p99 becomes more stable',
        'At 200 requests, p99 is decided by the 2 slowest requests, so it is mostly noise. Alert on a ratio-based SLI over a longer window (for example % of requests over 1 s across 1h) with a minimum request count, or on a lower percentile',
      ],
      correct: [3],
      explanation:
        'A percentile over a tiny sample is controlled by one or two requests (a single slow export query), so it flaps. Ratio SLIs over longer windows with minimum-volume guards (or synthetic traffic) give a statistically meaningful signal. A shorter evaluation interval adds more noise. Summaries do not fix the sample size and cannot be aggregated. More replicas reduce requests per pod and make per-pod percentiles even noisier.',
      followUps: [
        {
          "q": "The admin API is used by support agents, and when it's slow they can't help customers. How would you still alert usefully at 200 requests per 5 minutes?",
          "a": "Use counts and longer windows. Alert when, say, at least 10 requests exceeded 1 s in the last 30 minutes (absolute count), or when the slow ratio over 1 hour exceeds 5% with at least 100 requests. Add synthetic probes every 30 s that exercise the key admin queries, giving a steady signal independent of real traffic. Route to a ticket or a business-hours channel rather than paging overnight. Agents can also report via a 'this is slow' button that captures the trace id."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-09',
      difficulty: 'expert',
      question:
        'A 5-minute window of the latency histogram has the cumulative bucket counts below. The true p99 (from raw logs) is 150 ms and the SLO is "p99 < 200 ms". What does histogram_quantile(0.99, …) report?',
      code: {
        language: 'text',
        code: `http_server_request_duration_seconds_bucket{le="0.1"}  9800
http_server_request_duration_seconds_bucket{le="0.5"}  9990
http_server_request_duration_seconds_bucket{le="1"}    10000
http_server_request_duration_seconds_bucket{le="+Inf"} 10000`,
      },
      options: [
        '≈ 150 ms, because histogram_quantile uses the recorded observations inside the bucket',
        '≈ 500 ms, because it always returns the upper bound of the bucket containing the rank',
        '≈ 310 ms, from linear interpolation inside the 100–500 ms bucket, so the SLO looks violated when it is not',
        '≈ 100 ms, because it returns the lower bound of the first bucket holding 98% or more of observations',
      ],
      correct: [2],
      explanation:
        'Rank 9,900 falls in the (0.1, 0.5] bucket, which holds 190 observations, at fraction (9,900 − 9,800) ÷ 190 ≈ 0.53, so 0.1 + 0.53 × 0.4 ≈ 0.31 s. Prometheus assumes observations are spread uniformly inside a bucket; it does not keep raw values or return bucket bounds. The fix is to add bucket edges at the SLO threshold (for example 0.15, 0.2, 0.25), or to define the SLO as the ratio of requests with le = 0.2.',
      followUps: [
        {
          "q": "You add buckets at 0.15, 0.2, 0.25. What does that cost, and how do you choose bucket edges for a new service?",
          "a": "Each bucket is another time series per label combination: 3 extra buckets × (status × route × pod) can mean thousands of new series, so check cardinality before deploying. Choose edges around the decision points: the SLO threshold and a little either side, plus a few spread for the shape (for example 25, 50, 100, 150, 200, 250, 500 ms, 1 s, 2.5 s, 5 s). Prometheus native histograms avoid this trade-off with exponential buckets at high resolution and much lower series cost, so prefer them on Prometheus 2.40+ and supporting clients."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-10',
      difficulty: 'hard',
      question:
        'The checkout availability SLI is defined as below. Select ALL real problems with it.',
      code: {
        language: 'yaml',
        code: `sli:
  good:  sum(rate(http_requests_total{service="checkout", code!~"5.."}[5m]))
  total: sum(rate(http_requests_total{service="checkout"}[5m]))
# source: each pod's own /metrics endpoint, scraped by Prometheus
# routes include /healthz and /readyz (kubelet probes every 5s per pod)
# overload protection returns 429 when the pod's queue is full`,
      },
      options: [
        'Probe traffic to /healthz and /readyz is counted as good requests, inflating availability',
        'Server-side metrics miss requests that never reached a healthy pod (LB 502/503s, crashed pods, DNS failures)',
        '429s from our own load shedding count as good even though the user\'s checkout failed',
        'Using rate over 5m makes the SLI invalid for a 30-day SLO; it must be computed with increase over 30d only',
      ],
      correct: [0, 1, 2],
      explanation:
        'Health probes are not user traffic and should be excluded from both good and total. Metrics exported by the pods cannot count failures that happened before a pod saw the request, so measure at the LB or edge (or add synthetics). 429s caused by our own overload are user-facing failures; only 4xx caused by the client should be excluded. 5-minute rates are fine as building blocks; you sum good and total over the 30-day window from recording rules.',
      followUps: [
        {
          "q": "Rewrite the SLI. Where do you measure, and which status codes are good, bad or excluded?",
          "a": "Measure at the edge (ALB or ingress logs and metrics), so failures before a pod are counted, and exclude probe paths and internal synthetic traffic, or tag them. Good: 2xx, 3xx, and 4xx caused by the client (400, 401, 403, 404, 409, 422). Bad: 5xx, timeouts, connection resets at the LB, and 429/503 caused by our own overload or shedding. Excluded: 429 from a client exceeding its documented quota (arguably good). Write it as recording rules for good and valid events per 5 minutes, then sum both over 30 days, and add latency as a second SLI (good = under 800 ms)."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-11',
      difficulty: 'medium',
      question:
        'Your SLO and your customer SLA are both 99.9% monthly availability, with 10% credits on breach. On the 25th, the month-to-date availability reads 99.91%. What is the main problem with this setup?',
      options: [
        'Nothing: matching the SLO to the SLA guarantees that engineering and customers see the same number',
        'The SLA should be stricter than the SLO so customers are protected when engineering misses its target',
        'There is no buffer: the internal target leaves no warning margin before credits are owed. The SLO should be tighter (for example 99.95%) so you react while the SLA is still intact',
        'Monthly windows are invalid for SLAs; contracts must use rolling 28-day windows',
      ],
      correct: [2],
      explanation:
        'The SLO exists to give you an early warning and a margin before you breach the contract. With them equal, you learn you are in trouble at the moment you owe money: 99.91% after 25 days leaves only ~11 minutes of downtime for the rest of the month. The SLA should be looser, not stricter. Calendar months are common and legitimate in contracts, even if rolling windows are often better for internal SLOs.',
      followUps: [
        {
          "q": "Sales says the customer insists on 99.95% in the SLA. What does engineering need to sign up for internally, and what do you push back on?",
          "a": "With a 99.95% SLA (about 22 minutes per month), the internal SLO must be tighter, say 99.97–99.98%, about 9–13 minutes per month. That requires automated failover in minutes, no single-AZ dependencies on the critical path, and zero-downtime deploys. Check whether dependencies allow it: a chain of serial dependencies at 99.95% each multiplies below the target. Push back on the measurement details: exclude scheduled maintenance windows, define availability per request at the edge (not 'any 5xx in a minute equals a down minute'), and cap credits."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-12',
      difficulty: 'hard',
      question:
        'A 99.9% SLO allows about 43 minutes of full outage per 30 days. A 25-minute outage happens on the 30th of the month. How does the window type change what happens next?',
      options: [
        'With a calendar-month window the budget resets on the 1st, so the team can take full risk two days after the outage. With a rolling 30-day window the outage keeps counting until the 29th of the next month, so the budget recovers gradually',
        'Both window types behave the same after the outage, because an SLO is always judged over the last 30 days',
        'A rolling window forgets the outage after 24 hours, while a calendar window keeps it for the rest of the month',
        'With a calendar window the outage is carried into next month\'s budget, and with a rolling window it is dropped at midnight',
      ],
      correct: [0],
      explanation:
        'A calendar window starts from zero on the 1st, which can reward end-of-month risk and hide an unhealthy trend. A rolling window keeps each bad event in view for the full window length (here 30 days), so the budget comes back smoothly. That is why many teams use rolling windows internally and calendar months only for contracts. The other options misstate how each window works.',
      followUps: [
        {
          "q": "You run a calendar-month SLA but a rolling 30-day internal SLO. Can the two disagree on a given day, and how do you act on that?",
          "a": "Yes. On the 2nd, the calendar window has almost no data and looks perfect, while the rolling window still contains last month's outage and shows the budget nearly spent. Act on the rolling one for engineering decisions (freezes, reliability work), because it reflects recent behaviour continuously. Use the calendar one for contract reporting and credits. Show both on the dashboard, labelled clearly, so nobody reads the contract number and concludes it's safe to take risks."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-13',
      difficulty: 'expert',
      question:
        'This fast-burn page is the only SLO alert on checkout (SLO 99.9%). An incident caused 20% errors from 10:05 to 10:20, and then the fix landed. Until roughly when does the page keep firing, and what is the fix?',
      code: {
        language: 'yaml',
        code: `- alert: CheckoutFastBurn
  expr: slo:checkout_errors:ratio_rate1h > (14.4 * 0.001)
  for: 5m
  labels: { severity: page }`,
      },
      options: [
        'Until about 10:25: the alert resolves 5 minutes after errors stop, because of the for: 5m clause',
        'Until about 11:16: the 1h average stays above 1.44% while enough of the incident is still inside the window. Add a short window (ratio_rate5m > 14.4 × 0.001) combined with "and" so the alert resets within minutes of the fix',
        'Until about 11:05: exactly one hour after the incident started, when the first bad minute leaves the window',
        'It never fired, because 20% errors for 15 minutes is only 0.1% of the monthly budget',
      ],
      correct: [1],
      explanation:
        'The 1h ratio stays above 1.44% while more than 1.44% ÷ 20% × 60 ≈ 4.3 minutes of the incident remain inside the window. That lasts until about 11:15:40, nearly an hour after the fix, which pages people for a resolved problem and hides new ones. The Google SRE Workbook pattern adds a short window (1/12 of the long one) with "and", so the alert resolves quickly. The for clause only delays firing. 15 minutes at 20% is about 7% of the budget and it does fire.',
      followUps: [
        {
          "q": "With both windows, a slow-burning 0.3% error rate continues for days and never pages. Is that a gap?",
          "a": "It's handled by the slower tiers, which is why the multi-window setup has several. 0.3% is a 3× burn: it exhausts a 30-day budget in 10 days. The SRE Workbook's tiers: 14.4× over 1h (and 5m) pages, 6× over 6h (and 30m) pages, 3× over 1 day (and 2h) opens a ticket, and 1× over 3 days a ticket. So a 3× burn creates a ticket within about a day, not a page. If the business thinks 0.3% of failed checkouts for a day is urgent, adjust tier thresholds rather than adding raw error-rate alerts."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-14',
      difficulty: 'medium',
      question:
        'The search API promises 99.5% of requests succeed over a rolling 30 days. Since 04:00 (six hours ago) it has returned 3% 5xx without change. How fast is the budget going, and which alert tier applies?',
      options: [
        'Burn rate is 30×, and the monthly budget is already exhausted',
        'Burn rate is 3×: below the 14.4× threshold, so no alert should fire and no action is needed',
        'Burn rate is 6×: the last 6 hours used about 5% of the 30-day budget, and at this pace the budget runs out in about 5 days, which is exactly the 6×/6h page condition',
        'Burn rate is 6×: the last 6 hours used about 30% of the budget, so a release freeze is needed immediately',
      ],
      correct: [2],
      explanation:
        'The budget ratio is 1 − 0.995 = 0.5%, so burn = 3% ÷ 0.5% = 6. Six hours at 6× uses 6 × 6 ÷ 720 = 5% of a 30-day budget, and the full budget lasts 30 ÷ 6 = 5 days. That matches the 6× over 6h (and 30m) page tier. 30× divides by the wrong number. 3× forgets the budget ratio. 30% overstates the budget consumed by a factor of six.',
      followUps: [
        {
          "q": "The 3% errors all come from one large customer's malformed queries returning 500. Should they burn the SLO?",
          "a": "Partly: the 500 is our bug, since malformed input should get a 400. So it's a real defect and counts until fixed. Fix it in two steps: validate the input and return 4xx (which the SLI treats as good, client-caused), and stop the burn. Don't redefine the SLI to exclude one customer, since that hides real defects. If one tenant dominates traffic, consider per-tier or per-tenant SLIs so a single customer's pattern doesn't mask or exaggerate everyone else's experience."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-15',
      difficulty: 'hard',
      question:
        'Which of these should count as bad events against a checkout availability SLO? Select ALL that apply.',
      options: [
        '5xx responses caused by a cloud provider AZ failure',
        '404 responses for order IDs that clients requested but that do not exist',
        'Requests that timed out at the load balancer before reaching any pod',
        'Kubernetes liveness-probe failures on a pod that was receiving no user traffic',
        '503 load-shedding responses returned to real users during a traffic spike',
      ],
      correct: [0, 2, 4],
      explanation:
        'The SLI answers "did the user get what they needed?" Provider-caused 5xx, LB timeouts and our own load shedding are all user-visible failures, whatever their cause. Hiding them hides real risk (the policy can still decide how to react). A 404 for a nonexistent resource is a correct answer to a client mistake. Probe failures without user traffic are an operational signal, not a user event.',
      followUps: [
        {
          "q": "The AZ failure was AWS's fault. Does the error budget policy still freeze your releases?",
          "a": "The budget measures user experience, so it's consumed regardless of whose fault it was. The policy decides the response. Reasonable policies say: if a single incident consumed more than X% of the budget, do a postmortem and invest in the specific resilience gap (here, why did one AZ's loss cause user-visible errors? Multi-AZ capacity, health checks, failover speed). A freeze on unrelated feature releases helps less in that case. The important thing is that the remedy addresses the dependency, rather than pretending the outage didn't happen."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-16',
      difficulty: 'expert',
      question:
        'A B2B partner API receives about 6,000 requests per month (≈ 8 per hour). It has a 99.9% SLO and the standard 14.4×/1h burn-rate page. On-call gets paged whenever a single request fails. What is the best approach?',
      options: [
        'Keep the alert: a 99.9% SLO allows only 6 failures a month, so every failure really is urgent',
        'Lower the SLO to 95% so a single failure no longer crosses the burn threshold',
        'Add synthetic traffic for the key operations to raise the event count, require a minimum number of failed events before paging, and consider longer windows or a count-based "N failures in 6h" rule',
        'Switch the SLI to per-minute availability, since per-request SLIs are invalid below 1 RPS',
      ],
      correct: [2],
      explanation:
        'With 8 requests per hour, one failure makes the 1h error ratio 12.5%, far above the 1.44% threshold, so the alert fires on every blip. The Google SRE Workbook recommends synthetic traffic, combining services, or minimum-count thresholds for low-traffic services. Keeping the alert produces fatigue. Lowering the SLO to 95% changes the promise to hide an alerting problem. Per-minute SLIs are an option but do not fix the small-sample issue, and per-request SLIs are not invalid.',
      followUps: [
        {
          "q": "You add synthetic traffic every 30 s. What should synthetics do, and what can go wrong?",
          "a": "Exercise the partner's key operations end to end with a dedicated test account: authenticate, read, and a write that's cleaned up or idempotent. That's 2,880 checks per day per operation, enough events for burn-rate maths. Risks: synthetics may follow paths real partners don't (different data size, cached), so they can be green while partners fail, so keep real traffic in the SLI as well. They must not pollute business data or analytics (tag and filter them). And they need their own monitoring, because a broken synthetic looks like an outage."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-17',
      difficulty: 'hard',
      question:
        'A canary receives 1% of 200 RPS for 10 minutes. The baseline error ratio is 0.1%, and the new version secretly doubles it to 0.2%. What will the canary analysis most likely see?',
      options: [
        'A clear doubling of errors, since 1,200 requests is plenty for automated analysis',
        'About 2–3 errors expected on the canary (and ~1 at baseline levels), which cannot be told apart from noise; there is ~9% chance the canary shows zero errors',
        'Nothing measurable, because canaries cannot detect error-rate changes, only latency changes',
        'A false rollback, because small samples always make the canary look worse than the baseline',
      ],
      correct: [1],
      explanation:
        '2 RPS × 600 s = 1,200 requests; at 0.2% that is ~2.4 expected errors (Poisson P(0) = e^−2.4 ≈ 9%), against ~1.2 at the old rate, which is not statistically distinguishable. You need roughly 10K requests per arm to detect a doubling at these rates. Canaries can detect error changes with enough samples. Small samples are noisy in both directions, not biased toward failure.',
      followUps: [
        {
          "q": "You can't wait for 10K requests at 2 RPS. How else can you make the canary informative for this service?",
          "a": "Increase canary weight in steps (5% → 25% → 50%) with automated rollback, so you gather samples faster at the cost of larger blast radius per step. Replay shadow traffic: mirror a copy of production requests to the canary and compare responses and errors without serving them (only for safe, idempotent reads). Use more sensitive signals than the error rate: latency distributions, logs of new exception types, and per-endpoint errors. Accept that small regressions will be caught later by SLO burn alerts after full rollout, and keep rollback fast."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-18',
      difficulty: 'expert',
      question:
        'The pricing service (gRPC, called by 40 client pods) is canaried by adding one pod with the same Service selector, next to 19 stable pods. After 30 minutes the canary pod has very few requests and perfect metrics. Why?',
      code: {
        language: 'yaml',
        code: `# stable: Deployment pricing-v1, replicas: 19, labels { app: pricing }
# canary: Deployment pricing-v2, replicas: 1,  labels { app: pricing }
apiVersion: v1
kind: Service
metadata: { name: pricing }
spec:
  selector: { app: pricing }       # both versions behind one ClusterIP
  ports: [{ port: 50051 }]`,
      },
      options: [
        'The Service sends traffic to the newest pod only after it passes a 30-minute warm-up period',
        'gRPC does not work with ClusterIP Services, so the requests fail silently before reaching the canary',
        'The canary receives exactly 5% of requests; its metrics are perfect because the change really is safe',
        'kube-proxy balances connections, not requests. The gRPC clients hold long-lived HTTP/2 connections opened before the canary existed, so the canary only gets the rare new connections: a tiny, biased sample. Use L7 weighted routing (mesh) or client-side balancing with a max connection age',
      ],
      correct: [3],
      explanation:
        'A ClusterIP Service picks a backend per TCP connection. HTTP/2 multiplexes every request over a few long-lived connections, so already-connected clients never reach the new pod, and the canary sees little traffic, probably from just a few clients. The "5% by pod count" assumption is wrong. Services have no warm-up delay. gRPC works through ClusterIP; it just is not balanced per request. A mesh or proxyless gRPC balancing gives true request weighting.',
      followUps: [
        {
          "q": "You don't have a service mesh. How do you get a representative canary for gRPC with plain Kubernetes?",
          "a": "Make clients rebalance and give the canary a share. Set `MAX_CONNECTION_AGE` on the gRPC servers (say 1–5 minutes with grace), so clients periodically reconnect and spread across all pods, including the canary. Or use client-side balancing (gRPC `round_robin` over a headless Service, so each client connects to every pod), which balances per request. Then pod-count weighting (1 of 20 = 5%) roughly holds. For exact weights, route through an L7 proxy such as Envoy or a Gateway API `GRPCRoute` with weighted backends. Verify the canary's request share against expectations before trusting its metrics."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-19',
      difficulty: 'hard',
      question:
        'Which of these changes should NOT be trusted to a 5%, 30-minute canary alone? Select ALL that apply.',
      options: [
        'A migration that drops a column the previous version still reads',
        'New logic in the nightly settlement job, which runs only on the leader-elected pod',
        'A change to the Redis cache key format used by every pod',
        'A CPU optimisation inside a request handler that is exercised by every request',
      ],
      correct: [0, 1, 2],
      explanation:
        'A destructive migration affects every version at once and cannot be rolled back by shifting traffic; it needs expand/contract. Leader-only work probably never runs on the canary pod during the window. A cache key change looks fine while 95% of traffic keeps the old keys warm, but at 100% the hit rate collapses and the database takes the full load. A per-request CPU change is exactly what a canary measures well.',
      followUps: [
        {
          "q": "How would you roll out the cache key format change safely?",
          "a": "Avoid a cold-cache cliff. Option 1: dual-read: new code reads the new key, and on a miss reads the old key and writes the value under the new key, so the cache migrates organically as traffic hits it. Option 2: double-write: for a period, write both formats on every set, then switch reads to the new keys, then stop writing the old ones. Option 3: version the key prefix and pre-warm the new prefix for the hottest keys before rollout. Watch hit rate and DB load during each rollout step, and keep the old keys until their TTL expires so rollback stays warm."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-20',
      difficulty: 'medium',
      question:
        'The new checkout is rolled out with the flag check below at 10%. What will users and analysts experience?',
      code: {
        language: 'typescript',
        code: `@Post('checkout')
async checkout(@Req() req: AuthedRequest) {
  const pct = this.flags.get('new-checkout').percentage; // 10
  if (Math.random() * 100 < pct) {
    return this.newCheckout.handle(req);
  }
  return this.oldCheckout.handle(req);
}`,
      },
      options: [
        'Exactly 10% of users consistently get the new checkout, which is what a percentage rollout means',
        'Each request is assigned separately, so a user can hit old and new checkout in the same session (mixed state, confusing UX), and conversion metrics per variant are polluted. Bucket with hash(flagKey + ":" + userId)',
        'Math.random is re-seeded per process, so all users on a given pod get the same variant',
        'The flag lookup on every request is the main problem; caching the percentage would make assignment sticky',
      ],
      correct: [1],
      explanation:
        'A random draw per request gives about 10% of requests, not 10% of users, the new path. Nearly every active user will see both variants over a session, and the analysis cannot attribute outcomes to one variant. Deterministic hashing of the flag key plus user ID makes the assignment sticky and independent across flags. Math.random is not seeded per pod in a way that groups users. Caching the percentage does not change the per-request random draw.',
      followUps: [
        {
          "q": "Anonymous users have no userId. How do you keep assignment sticky for them, and what happens when they log in?",
          "a": "Bucket on a stable anonymous id: a first-party cookie or device id set on first visit. On login, either keep using the anonymous id for that experiment's duration (sticky through login), or alias it to the user id and accept that the user may switch variants once. LaunchDarkly and similar tools handle this with context aliasing or multi-context keys. Decide per experiment: for checkout, switching mid-funnel is confusing, so keep the anonymous key until the session ends. Log the bucketing key with every exposure event so analysis uses the same unit."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-21',
      difficulty: 'expert',
      question:
        'Two experiments run at the same time: new search ranking (10%) and new checkout (10%). Both use enabled = hash(userId) % 100 < pct. The checkout experiment reports an 8% lift in conversion. Why should you distrust the result?',
      options: [
        'Both flags select exactly the same users (buckets 0–9), so the checkout group also got the new search. The lift cannot be attributed to checkout. Salt the hash per flag (hash(flagKey + userId))',
        'A 10% sample is too small for conversion experiments; you need at least 50%',
        'Modulo 100 of a hash is biased toward low buckets, so the treatment group is skewed to early sign-ups',
        'Running two experiments at once is never valid; experiments must always run one after the other',
      ],
      correct: [0],
      explanation:
        'Without a per-flag salt, every flag at 10% picks the same slice of users, so the treatment groups overlap 100% and the effects are confounded. Proper SDKs hash the flag key (plus salt) with the user key, giving independent assignment and allowing concurrent experiments. 10% can be plenty with enough traffic. A good hash mod 100 is close to uniform. Concurrent, independently randomised experiments are standard practice.',
      followUps: [
        {
          "q": "You fix the salting. Can the two experiments still interact, and how do you check?",
          "a": "Yes, legitimately: with independent assignment, about 1% of users get both treatments, and the new search might change what users add to carts, influencing checkout outcomes. Independent randomisation makes the main effects unbiased estimates averaged over the other experiment's mix, but an interaction can still exist. Check by analysing the 2×2 cells (both, search only, checkout only, neither) for a significant interaction term. If experiments are known to conflict (both change the same page element), put them in mutually exclusive layers, so a user is in at most one of them."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-22',
      difficulty: 'hard',
      question:
        'During an incident, on-call flips the "disable-recommendations" kill switch for the first time in 14 months. The homepage starts returning 500s, because the fallback path calls an endpoint that was removed last year. Which practices would have prevented this? Select ALL that apply.',
      options: [
        'Automated tests that run the critical paths with each kill switch both on and off',
        'Scheduled game days that flip kill switches in production at low traffic and verify the fallback',
        'Increasing the flag SDK cache TTL so kill-switch changes propagate more slowly and more safely',
        'Converting the kill switch into a deploy-time environment variable so changes go through CI',
        'Flag metadata with an owner, plus an alert on kill switches that have not been exercised in 90 days',
      ],
      correct: [0, 1, 4],
      explanation:
        'Code that never runs rots. Testing both flag states, exercising switches regularly, and giving each switch an owner and an "exercise by" date keep the fallback path working. A longer cache TTL only slows the emergency action. Turning the switch into an env var makes it slower (needs a deploy) and still does not test the fallback path.',
      followUps: [
        {
          "q": "Write the test that would have caught this. Where does it run, and how often?",
          "a": "A parametrised integration or e2e test: for each kill switch marked as critical in the flag metadata, run the critical-path journeys (homepage, product page, checkout) with the switch on and off, asserting 2xx and a sensible degraded render. Run it in CI on every change to services that own or use the switch, plus nightly against staging with the real dependencies. The test list comes from the flag registry, so a new kill switch automatically gets coverage. Pair it with a quarterly production exercise at low traffic, since staging may not match production configuration."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-23',
      difficulty: 'hard',
      question:
        'A 3-node Raft cluster (etcd) was placed as 2 nodes in AZ-a and 1 in AZ-b, because AZ-c had no capacity that day. What happens when AZ-a fails, and what is the right placement?',
      options: [
        'The cluster loses quorum (1 of 3) and stops accepting writes until AZ-a returns. Place nodes 1-1-1 across three AZs (or 2-2-1 with 5 nodes) so no single AZ holds a majority',
        'The AZ-b node becomes leader and keeps accepting writes, because it has the latest committed log',
        'Nothing is lost if the cluster was running a 4th learner node in AZ-b',
        'The cluster keeps working in read-only mode for writes that are already queued',
      ],
      correct: [0],
      explanation:
        'Raft needs a majority (2 of 3) to elect a leader and commit. Losing the AZ that holds 2 nodes leaves 1, so the cluster is unavailable for writes, and linearizable reads also fail. Spreading nodes so no single AZ holds a majority (1-1-1, or 2-2-1 for 5 nodes) survives any one AZ. Learners do not vote, and there is no mode that commits queued writes without quorum.',
      followUps: [
        {
          "q": "AZ-c still has no capacity. You can't do 1-1-1 today. What's your least-bad option?",
          "a": "Options: run 5 nodes as 2 (AZ-a) + 2 (AZ-b) + 1 in another AZ such as AZ-d if the region has one, since no AZ then holds a majority. If only two AZs are usable, no placement survives either AZ's loss with a majority. Then choose which failure to survive: 2 in AZ-b and 1 in AZ-a means losing AZ-a is fine and losing AZ-b is fatal, so put the majority in the AZ you judge more reliable, and document it. Request capacity reservations in AZ-c and migrate a member there (`etcdctl member add`, then remove) as soon as capacity appears."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-24',
      difficulty: 'expert',
      question:
        'A single-replica Redis StatefulSet on EKS uses the StorageClass below. AZ-a (where its node and volume live) has a multi-hour outage. What happens to the Redis pod?',
      code: {
        language: 'yaml',
        code: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata: { name: gp3 }
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
parameters: { type: gp3 }
---
# StatefulSet redis: replicas: 1, volumeClaimTemplates -> storageClassName: gp3`,
      },
      options: [
        'Kubernetes reschedules the pod to a node in AZ-b and re-attaches the same EBS volume there within a few minutes',
        'WaitForFirstConsumer lets the scheduler pick a new zone for the existing volume after a failure, so the pod moves automatically',
        'The pod stays Pending: its PersistentVolume is an EBS volume bound to AZ-a (node affinity), and EBS cannot attach across zones. You need replication across AZs (replicas with their own volumes, or a managed Multi-AZ service), or a restore from snapshot',
        'The EBS CSI driver copies the volume to AZ-b in the background, which makes the pod start slowly but safely',
      ],
      correct: [2],
      explanation:
        'EBS volumes are zonal, and the PV carries node affinity to its zone, so the pod can only run in AZ-a. WaitForFirstConsumer only delays the *initial* provisioning until a pod is scheduled; it does not move an existing volume. There is no automatic cross-AZ copy. Zone resilience for stateful workloads comes from replication at the application or managed-service level, not from the volume.',
      followUps: [
        {
          "q": "The Redis is just a cache. Would you still fix this, and how cheaply?",
          "a": "Yes, because when the pod is stuck Pending for hours, every request falls back to the DB, which may not survive that load; a cache outage becomes a DB outage. Cheap fixes: since it's a cache, don't use a PersistentVolume at all (emptyDir), so the pod reschedules into any AZ immediately and starts empty; protect the DB with single-flight and miss-path limits while it warms. Or run a managed Multi-AZ service with a replica in another AZ (ElastiCache with automatic failover), at roughly 2× the cost. Persistent zonal volumes make sense only if the data must survive restarts."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-25',
      difficulty: 'medium',
      question:
        'The VPC has private subnets in 3 AZs, but all of them route 0.0.0.0/0 through one NAT gateway in AZ-a. AZ-a fails. What is the impact on pods in AZ-b and AZ-c?',
      options: [
        'None: NAT gateways are regional, so AWS moves traffic to another AZ automatically',
        'They lose outbound internet access (payment providers, third-party APIs, external SaaS), so any flow that needs egress fails even though those AZs are healthy. Use one NAT gateway per AZ with per-AZ route tables',
        'Only inbound traffic from the load balancer is affected, and outbound calls keep working',
        'Pods in AZ-b and AZ-c fail over to using their node\'s public IP addresses automatically',
      ],
      correct: [1],
      explanation:
        'A standard NAT gateway lives in one AZ. Routing every subnet through it makes egress a single zonal point of failure (and adds cross-AZ data charges on normal days). The recommended pattern is a NAT gateway per AZ, with each AZ\'s route table pointing to its local one. Inbound LB traffic is separate. Pods in private subnets have no public IPs to fall back to.',
      followUps: [
        {
          "q": "One NAT gateway per AZ triples the fixed cost. When is that worth it, and are there cheaper ways to reduce egress dependence?",
          "a": "Each NAT gateway costs about $32/month plus data processing, so three is about $100/month, trivial compared with checkout failing when one AZ fails. It also eliminates cross-AZ transfer charges for egress traffic, which often pays for it. Reduce egress dependence further: use VPC endpoints (Gateway endpoints for S3 and DynamoDB are free; Interface endpoints for other AWS services) so AWS API traffic never touches NAT. For third-party APIs that need fixed IPs, use NAT Elastic IPs per AZ and have the partner allow-list all three."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-26',
      difficulty: 'hard',
      question:
        'The shopping cart uses a DynamoDB global table replicated between Mumbai and Singapore. Users are routed to the nearest region, and a user\'s phone and laptop can hit different regions. Some users report items vanishing from their cart. Why?',
      code: {
        language: 'typescript',
        code: `async function addToCart(userId: string, item: CartItem) {
  const { Item } = await ddb.get({ TableName: 'carts', Key: { userId } });
  const cart = Item ?? { userId, items: [] };
  cart.items.push(item);                      // read-modify-write of the whole cart
  await ddb.put({ TableName: 'carts', Item: cart });
}`,
      },
      options: [
        'DynamoDB global tables only replicate every 24 hours, so the items appear later',
        'The put should use a ConditionExpression on version, which prevents conflicts across regions',
        'Strongly consistent reads in each region would make the two regions agree before writing',
        'Concurrent writes to the same item in two regions are resolved last-writer-wins for the whole item, so one region\'s add overwrites the other\'s. Store each cart line as its own item (userId + itemId key), or route each user\'s writes to a home region',
      ],
      correct: [3],
      explanation:
        'Global tables replicate asynchronously (typically in about a second) and resolve concurrent updates to the same item with last-writer-wins, so one full-cart overwrite silently drops the other add. Separate items per line avoid conflicting on the same item, and home-region routing avoids concurrent multi-region writes. Conditional writes and strongly consistent reads only apply within one region; they cannot see a write not yet replicated from the other region.',
      followUps: [
        {
          "q": "You store each cart line as its own item. A user removes an item in Mumbai while adding the same item again in Singapore. What's the outcome?",
          "a": "Both regions write the same item key `(userId, itemId)` concurrently: Mumbai deletes it, Singapore puts it with quantity 1. Global tables resolve with last-writer-wins by timestamp, so whichever operation is later wins. The user may see the item reappear or vanish. For carts, that's usually acceptable as a rare edge case. To make it more predictable, use soft deletes with a version or timestamp and resolve 'add wins' in the application (an OR-set CRDT style), or route each user's writes to a home region so these concurrent cross-region writes don't happen."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-27',
      difficulty: 'hard',
      question:
        'The EU region hosts EU customers\' personal data under a residency commitment. The DR runbook says: "if eu-west-1 fails, route EU traffic to us-east-1, which holds an async replica of all data". What is the main problem?',
      options: [
        'Async replication to us-east-1 is too slow to meet any RTO',
        'Keeping and serving EU personal data in the US breaks the residency commitment, both during normal operation (the replica) and during failover. DR for EU data needs a second EU region (for example eu-central-1), with only non-personal data allowed to leave',
        'The US region cannot serve EU users because of latency; there is no compliance issue',
        'Failover across continents is impossible with DNS, so the plan cannot work technically',
      ],
      correct: [1],
      explanation:
        'Residency constraints apply to where data is stored and processed, not just the "normal" path. A standing US replica already violates the commitment, and failing over makes it worse. The usual design uses two regions within the jurisdiction, and data classification decides what can be replicated globally. Latency matters but is not the main problem, and DNS can route across continents.',
      followUps: [
        {
          "q": "Which data can legitimately replicate to us-east-1, and how do you enforce the split in the code and infrastructure?",
          "a": "Data classification decides: non-personal data (product catalog, pricing, aggregated and anonymised analytics, service configuration) can usually go global. Personal data (names, emails, addresses, orders tied to identities, logs containing IPs) stays in EU regions. Enforce it in infrastructure: separate EU-only databases, buckets and Kafka clusters for PII, with SCPs or organisation policies that deny creating replicas or buckets outside allowed regions; and in code: tag schemas or fields with classification and lint for PII in global topics. Audit logs and traces too, since they often leak PII to global stores."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-28',
      difficulty: 'hard',
      question:
        'Step 1 of your regional failover runbook is "call the Route 53 API to change api.example.com to the DR load balancer". Why does AWS guidance advise against this, and what is preferred?',
      options: [
        'Record changes are control-plane operations (served from us-east-1), which may be impaired during large events. Prefer data-plane mechanisms: pre-created failover records driven by health checks, or Application Recovery Controller routing controls',
        'Route 53 API changes take up to 48 hours to propagate worldwide, so failover would be too slow',
        'Route 53 cannot point to load balancers in another region, so an alias record would fail',
        'API changes are fine, but only if the TTL is set to 0 so clients never cache the record',
      ],
      correct: [0],
      explanation:
        'AWS separates the highly available Route 53 data plane (answering queries, evaluating health checks) from its control plane (editing records), which is hosted in us-east-1. Recovery should depend only on data-plane actions set up in advance. Changes normally reach Route 53\'s servers within about a minute, not 48 h. Cross-region alias and failover records are supported. TTL 0 is not a real fix and increases query load.',
      followUps: [
        {
          "q": "Set up the data-plane failover. What do you pre-create, and how do you trigger it during the event?",
          "a": "Pre-create Route 53 failover records: primary pointing to Mumbai's load balancer and secondary to Singapore's, each associated with a health check. For human-controlled failover, use Application Recovery Controller routing controls tied to those health checks: flipping a routing control is a data-plane API call served by a highly available cluster of endpoints in five regions, which you can call from any of them. Keep TTLs short (30–60 s). Store the cluster endpoints and credentials in the runbook so the operator doesn't depend on the console or us-east-1. Test the flip quarterly."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-29',
      difficulty: 'hard',
      question:
        'Nightly backups run with the script below. Select ALL real risks.',
      code: {
        language: 'bash',
        code: `#!/usr/bin/env bash
# runs at 02:00 on a prod node, using the node's IAM role (s3:* on prod-backups)
set -euo pipefail
pg_dump "$DATABASE_URL" -Fc | gzip > /tmp/orders.dump.gz
aws s3 cp /tmp/orders.dump.gz s3://prod-backups/orders/$(date +%F).dump.gz
# lifecycle rule on prod-backups deletes objects after 7 days
# no restore job exists`,
      },
      options: [
        'Anyone (or any ransomware) holding prod credentials can delete or overwrite the backups, because they sit in the same account with s3:* and no Object Lock',
        'The RPO is up to ~24 hours, and corruption noticed after 7 days cannot be recovered at all',
        'Nobody has verified the dumps can be restored within the RTO; an untested backup might be empty, truncated or too slow to restore',
        'pg_dump produces an inconsistent copy, because tables are dumped at different times while writes continue',
      ],
      correct: [0, 1, 2],
      explanation:
        'The backups share fate with production credentials, have a daily RPO and a short retention window (7 days is shorter than many detection delays), and are never restored, so nobody knows whether they work. Fix with a separate account, Object Lock, PITR through WAL archiving, longer retention and automated restore tests. pg_dump takes a consistent snapshot of the database within a single transaction, so the "inconsistent copy" option is a misconception. (Compressing an already-compressed -Fc dump is wasteful but not dangerous.)',
      followUps: [
        {
          "q": "Design the replacement backup setup. What do you change for RPO, retention and isolation?",
          "a": "RPO: enable point-in-time recovery: continuous WAL archiving (pgBackRest, WAL-G, or RDS automated backups), giving an RPO of about 5 minutes or less, plus weekly base backups. Retention: 35 days of PITR and monthly snapshots kept for a year, sized to the longest plausible detection delay for corruption. Isolation: copy backups to a separate AWS account with S3 Object Lock in compliance mode, where production credentials can write but not delete. Verification: an automated job restores the latest backup weekly into a scratch instance, runs checksums or row-count checks, and reports the restore time against the RTO."
        }
      ],
    },
    {
      id: 'misc-ops-mcq-30',
      difficulty: 'expert',
      question:
        'In a DR drill you restore a 2 TB database from an EBS snapshot. The restore is "available" in 20 minutes, but for the next hour queries run 10–50× slower than in production, and the RTO target of 45 minutes is missed. What explains this, and what fixes it?',
      options: [
        'Postgres rebuilds all indexes after a restore, which takes about an hour for 2 TB',
        'The query planner has no statistics after a restore; running ANALYZE brings latency back to normal immediately',
        'Volumes restored from snapshots load blocks lazily from S3 on first access, so every cold block read is slow until the volume is warmed. Pre-warm the volume (read every block), enable Fast Snapshot Restore, or keep a running replica for tier-1 data',
        'Snapshots are compressed, and the storage layer decompresses each block on the CPU, which throttles queries',
      ],
      correct: [2],
      explanation:
        'EBS (and snapshot-based RDS restores) hydrate data lazily from S3, so first touches of each block are slow. "Restore complete" does not mean "performance restored", and the RTO must include warm-up. Fast Snapshot Restore or pre-reading the blocks removes the penalty, and a live replica avoids it entirely. Indexes are restored as data, not rebuilt. Missing statistics can hurt specific plans but do not cause a uniform, hour-long slowdown. Decompression is not the bottleneck.',
      followUps: [
        {
          "q": "Fast Snapshot Restore is expensive at scale. How do you decide which databases get it, or something better?",
          "a": "Tier by RTO. Tier 1 (payments, auth, with RTOs of minutes) should not depend on snapshot restores at all: keep a running replica in another AZ or region, which is already warm. Tier 2 (internal tools, with RTOs of hours) can use FSR on only the latest snapshot (FSR costs about $0.75 per hour per snapshot per AZ, so enable it just for the snapshot you'd restore), or accept lazy loading plus a pre-warm step (`fio` reading every block) built into the runbook timing. Tier 3 restores lazily. Measure each tier's real restore time in drills."
        }
      ],
    },
  ],
};

export default topic;
