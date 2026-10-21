import type { Topic } from '../../types';

const topic: Topic = {
  id: 'observability',
  phase: 'platform',
  order: 2,
  title: 'Observability: Logs, Metrics, Traces & SLOs',
  subtitle:
    'Structured logs, Prometheus metrics, OpenTelemetry traces, sampling, cardinality, SLOs, error budgets and burn-rate alerting, plus how to debug a 20-service system at 3am.',
  estimatedMinutes: 110,
  sources: [
    'Mastering API Architecture — Ch 5 Deploying and Releasing APIs (Observability, reading signals, header propagation)',
    'Alex Xu — System Design Interview Vol 2, Ch 5 Metrics Monitoring and Alerting System',
    'Google SRE Workbook — Ch 5 Alerting on SLOs',
    'OpenTelemetry & W3C Trace Context specifications',
  ],
  tags: [
    'observability',
    'logging',
    'metrics',
    'tracing',
    'opentelemetry',
    'prometheus',
    'slo',
    'error-budget',
    'alerting',
    'grafana',
    'loki',
  ],
  cheatSheet: [
    'Monitoring answers known questions (is it up?); observability lets you ask NEW questions of logs, metrics and traces without shipping new code.',
    'Metrics = cheap, aggregatable, alertable; logs = high-detail events; traces = causality and latency across services. Join them with trace_id (logs) and exemplars (metrics).',
    'RED for services (Rate, Errors, Duration), USE for resources (Utilization, Saturation, Errors), Golden Signals = latency, traffic, errors, saturation.',
    'Counter only goes up (use rate()); gauge goes up and down; histogram buckets are aggregatable across pods; summaries are NOT; never average percentiles.',
    'Series count = product of label cardinalities (× ~14 for a 12-bucket histogram). Never put user_id, order_id, raw URL or error message in a metric label.',
    'W3C traceparent = 00-{32-hex trace-id}-{16-hex parent span-id}-{flags}; every hop (HTTP, Kafka headers, gRPC metadata) must propagate it; meshes cannot do it for you.',
    'Head sampling decides at the root (cheap, blind to errors); tail sampling decides after the trace completes (keeps errors/slow, needs trace-ID-aware routing and buffer memory).',
    'SLI = good events / valid events measured close to the user; SLO = target (99.9% over 30d = 43.2 min or 0.1% of requests); SLA = contract with penalties, looser than SLO.',
    'Alert on error-budget burn rate, not CPU: page at 14.4× over 1h (and 5m) = 2% of budget, 6× over 6h (and 30m) = 5%; ticket at 1× over 3d.',
    'Control log cost: JSON logs, INFO default, sample successful access logs, keep all errors, low-cardinality Loki labels, hot 7–15 days then object storage.',
  ],
  sections: [
    {
      heading: 'Monitoring vs observability, and the three pillars',
      body: `**Intuition:** monitoring is the dashboard light in your car ("engine hot"). Observability is being able to open the bonnet and work out *why* — including for failure modes nobody predicted.

In a monolith you attach a debugger. In 40 NestJS services behind a gateway, a single user request touches the gateway, auth, orders, pricing, Postgres, Redis and Kafka. The failure is rarely "a box is down"; it is "p99 of checkout for tenant X on iOS doubled since 14:05". You can only answer that if the system emits enough *high-context* telemetry.

| Pillar | What it is | Strength | Weakness | Typical stack |
|---|---|---|---|---|
| **Metrics** | Numeric time series (name + labels + value) | Cheap, aggregatable, perfect for alerts and trends | Lose per-request detail; label cardinality limits | Prometheus, Mimir/Thanos, VictoriaMetrics, Datadog |
| **Logs** | Timestamped discrete events | Full detail of one event, arbitrary fields | Expensive at volume, hard to aggregate | Loki, Elasticsearch/OpenSearch, CloudWatch |
| **Traces** | Tree of spans for one request across services | Causality, critical path, where time is spent | Need propagation everywhere; must sample | OpenTelemetry + Tempo/Jaeger/Honeycomb |

The pillars are only powerful when **linked**: an alert fires on a metric → an *exemplar* on the latency histogram points to a trace ID → the trace shows the slow span → you query logs by \`trace_id\` for that span. Many teams now add a fourth pillar: **continuous profiling** (Pyroscope, Parca) to see *which function* burns CPU or allocates memory.

Mastering API Architecture frames this around releases: separating deployment from release only works if you can **read signals** quickly enough to decide "roll forward or roll back". Observability is the feedback loop for every other practice (canary, feature flags, incident response).

**In interviews say:** "I instrument with OpenTelemetry once, export to a collector, and fan out: metrics to Prometheus, traces to Tempo, logs to Loki — all correlated by trace_id, with SLO burn-rate alerts rather than resource alerts."`,
      diagram: `  app pods (NestJS + OTel SDK)
   |  metrics /metrics (pull)   traces+logs OTLP (push)
   v                              v
+-----------+            +------------------+
| Prometheus|<--scrape-- | OTel Collector   |--tail sampling--> Tempo
| / Mimir   |            | (agent+gateway)  |--logs-----------> Loki
+-----+-----+            +------------------+
      | alerts (burn rate)            ^
      v                               | trace_id links
 Alertmanager --> PagerDuty/Slack     |
      |                               |
      +------> Grafana: metric --exemplar--> trace --> logs`,
      keyPoints: [
        'Observability = ability to ask new questions without redeploying.',
        'Metrics alert, traces localize, logs explain.',
        'Correlation (trace_id in logs, exemplars on histograms) is what makes the pillars useful together.',
      ],
      source: 'Mastering API Architecture — Ch 5 (three pillars of observability)',
    },
    {
      heading: 'Structured logging and correlation IDs',
      body: `**Intuition:** a plain-text log line is a sentence a human must read; a structured log line is a database row a machine can filter. At 10K RPS nobody reads — everybody queries.

**Rules for production logs**
- **JSON, one event per line**, with stable keys: \`timestamp\`, \`level\`, \`service\`, \`version\`, \`trace_id\`, \`span_id\`, \`request_id\`, \`tenant_id\`, \`msg\`, plus event-specific fields (\`latency_ms\`, \`order_id\`).
- **Correlation ID**: accept \`x-request-id\` from the edge (bounded length) or generate one, return it in the response, and propagate it downstream. With OpenTelemetry, the **trace_id is the correlation ID** — always log it.
- **Context without parameter-drilling**: Node's \`AsyncLocalStorage\` carries request context across \`await\`s. Never store request IDs in a module-level variable — concurrent requests overwrite each other.
- **Redact** secrets and PII at the logger (authorization headers, passwords, card numbers). Logs are the #1 accidental PII leak.
- **Levels mean something**: ERROR = a human may need to act; WARN = degraded but handled; INFO = business events and one access log per request; DEBUG off in prod (toggle dynamically per service when investigating).

pino is the go-to in Node: it serializes asynchronously and is roughly 5× faster than winston in benchmarks, which matters because synchronous \`console.log\` of big objects blocks the event loop.`,
      code: [
        {
          language: 'typescript',
          title: 'logger.ts — pino + AsyncLocalStorage + trace correlation',
          code: `import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { trace } from '@opentelemetry/api';
import type { Request, Response, NextFunction } from 'express';

type RequestCtx = { requestId: string; tenantId?: string };
export const requestContext = new AsyncLocalStorage<RequestCtx>();

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'orders-api', version: process.env.GIT_SHA },
  // redaction happens before serialization, so secrets never hit stdout
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', 'card.number'],
  // mixin runs on EVERY log call: enrich with request + active span context
  mixin() {
    const ctx = requestContext.getStore();
    const span = trace.getActiveSpan()?.spanContext();
    return {
      request_id: ctx?.requestId,
      tenant_id: ctx?.tenantId,
      trace_id: span?.traceId,
      span_id: span?.spanId,
    };
  },
});

export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  // trust but bound: attacker-controlled header must not bloat logs
  const requestId = incoming && /^[\\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', requestId);
  requestContext.run({ requestId, tenantId: req.header('x-tenant-id') }, () => next());
}`,
        },
        {
          language: 'json',
          title: 'One resulting log line (queryable by any field)',
          code: `{"level":30,"time":1727512345123,"service":"orders-api","version":"9f3c2a1",
 "request_id":"b1d2c3e4-...","tenant_id":"acme","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736",
 "span_id":"00f067aa0ba902b7","msg":"order created","order_id":"ord_81723","latency_ms":42}`,
        },
      ],
      keyPoints: [
        'JSON logs with stable keys; always include trace_id.',
        'AsyncLocalStorage for request context — never module-level mutable state.',
        'Redact at the logger; treat logs as a data store subject to compliance.',
      ],
    },
    {
      heading: 'Metric types: counter, gauge, histogram, summary',
      body: `**Intuition:** a counter is an odometer, a gauge is a speedometer, a histogram is a tally of how many trips fell into each duration bucket.

| Type | Semantics | Query with | Example |
|---|---|---|---|
| **Counter** | Monotonic, resets to 0 on restart | \`rate()\` / \`increase()\` (handle resets) | \`http_requests_total\`, \`orders_created_total\` |
| **Gauge** | Current value, up or down | raw, \`avg_over_time\`, \`max_over_time\` | queue depth, pool waiting clients, memory |
| **Histogram** | Cumulative bucket counters \`_bucket{le=...}\` + \`_sum\` + \`_count\` | \`histogram_quantile()\` over \`sum by (le)\` | request duration, payload size |
| **Summary** | Client-side precomputed quantiles | read directly | legacy; **cannot be aggregated across pods** |

Key mechanics that trip people up:
- **Never average percentiles.** The mean of 20 pods' p99 is not the fleet p99. Sum the histogram buckets across pods, then compute the quantile.
- **Bucket boundaries are your precision.** \`histogram_quantile\` linearly interpolates inside a bucket; if your SLO threshold is 300 ms you need a bucket at exactly \`le="0.3"\` to count "good" requests exactly.
- \`rate()\` needs at least two samples in the window; use a range of **≥ 4× the scrape interval** (15 s scrape → \`[1m]\` minimum, \`[5m]\` typical).
- **Native (exponential) histograms** in Prometheus 2.40+ / 3.x give automatic high-resolution buckets at far lower series cost — worth mentioning as the modern answer.
- Default \`prom-client\` metrics give you Node-specific gold: \`nodejs_eventloop_lag_p99_seconds\`, GC durations, heap usage, active handles.`,
      code: [
        {
          language: 'typescript',
          title: 'metrics.ts — prom-client with bounded labels',
          code: `import { Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';
import { pool } from './db'; // pg.Pool

collectDefaultMetrics(); // CPU, heap, GC, event-loop lag (nodejs_eventloop_lag_p99_seconds)

export const httpDuration = new Histogram({
  name: 'http_server_request_duration_seconds',
  help: 'Server-side HTTP latency',
  labelNames: ['method', 'route', 'status_class'] as const,
  // include the SLO threshold (0.3s) as an exact bucket boundary
  buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2.5, 5],
});

export const ordersCreated = new Counter({
  name: 'orders_created_total',
  help: 'Orders successfully created',
  labelNames: ['channel'] as const, // web | ios | android — bounded
});

export const dbPoolWaiting = new Gauge({
  name: 'db_pool_waiting_clients',
  help: 'Requests queued waiting for a Postgres connection (USE: saturation)',
  collect() {
    this.set(pool.waitingCount); // sampled at scrape time, no timers needed
  },
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = httpDuration.startTimer({ method: req.method });
  // 'finish' fires after exception filters set the final status code
  res.on('finish', () => {
    end({
      route: req.route?.path ?? 'unmatched', // template '/orders/:id', never the raw URL
      status_class: Math.floor(res.statusCode / 100) + 'xx',
    });
  });
  next();
}`,
        },
      ],
      keyPoints: [
        'Counters → rate(); gauges → current value; histograms → histogram_quantile over summed buckets.',
        'Summaries cannot be aggregated across instances; prefer histograms.',
        'Put the SLO threshold on an exact bucket boundary.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 5 (data model, metric types)',
    },
    {
      heading: 'RED, USE and the Golden Signals (with PromQL)',
      body: `**Intuition:** RED tells you how your *customers* feel, USE tells you how your *machines* feel. You need both — a service can be RED-unhappy while every machine is USE-happy (e.g., waiting on a lock or a downstream).

| Method | Applies to | Signals | Classic question it answers |
|---|---|---|---|
| **RED** (Tom Wilkie) | Request-driven services | Rate, Errors, Duration | "Is the orders API healthy for callers?" |
| **USE** (Brendan Gregg) | Resources: CPU, memory, disk, NIC, **connection pools, thread pools, queues** | Utilization, Saturation, Errors | "Which resource is the bottleneck?" |
| **Golden Signals** (Google SRE) | User-facing systems | Latency, Traffic, Errors, Saturation | Superset: RED + saturation |

**Saturation is the most under-instrumented signal** and the one that explains "slow but CPU normal": requests queued for a DB connection, Node's libuv threadpool (default 4 threads — used by \`dns.lookup\`, \`fs\`, \`crypto.pbkdf2\`, zlib), HTTP agent \`maxSockets\`, Kafka consumer lag, or the event loop itself.

Latency hygiene:
- Separate latency of **successful vs failed** requests — fast 500s make the average look great.
- Look at p50, p95, p99 and max; tail latency matters because a page fanning out to 20 calls hits a p99 on most loads (1 − 0.99^20 ≈ 18% of pages).
- Split every RED metric by \`route\`, \`status_class\`, \`version\` and \`pod\` to localize quickly.`,
      code: [
        {
          language: 'text',
          title: 'PromQL: RED + USE queries you should be able to write on a whiteboard',
          code: `# RATE — requests/sec per route
sum by (route) (rate(http_server_request_duration_seconds_count{service="orders"}[5m]))

# ERRORS — 5xx ratio
sum(rate(http_server_request_duration_seconds_count{service="orders",status_class="5xx"}[5m]))
  /
sum(rate(http_server_request_duration_seconds_count{service="orders"}[5m]))

# DURATION — fleet p99 per route (sum buckets across pods FIRST, keep le)
histogram_quantile(0.99,
  sum by (le, route) (rate(http_server_request_duration_seconds_bucket{service="orders"}[5m])))

# Fraction of requests faster than the 300ms SLO threshold
sum(rate(http_server_request_duration_seconds_bucket{service="orders",le="0.3"}[5m]))
  / sum(rate(http_server_request_duration_seconds_count{service="orders"}[5m]))

# USE — DB pool saturation and Node event-loop saturation
max by (pod) (max_over_time(db_pool_waiting_clients[5m]))
max by (pod) (nodejs_eventloop_lag_p99_seconds)

# Which version is failing after a deploy?
sum by (version) (rate(http_server_request_duration_seconds_count{status_class="5xx"}[5m]))`,
        },
      ],
      keyPoints: [
        'RED = customer view, USE = resource view; saturation explains most "slow but idle" mysteries.',
        'Pools, queues and the event loop are resources — instrument them with USE.',
        'Always break down by version and pod to localize.',
      ],
      source: 'Mastering API Architecture — Ch 5 (important API metrics)',
    },
    {
      heading: 'Cardinality explosion — the silent killer of metrics systems',
      body: `**Intuition:** every unique combination of label values is a separate time series with its own memory. Labels multiply, they don't add.

**Series = Π (distinct values per label)** × series-per-metric. A histogram with 10 buckets emits 10 + \`+Inf\` + \`_sum\` + \`_count\` = **13 series per label combination** (≈14 with 12 buckets).

Example: \`method(4) × route(50) × status_class(5) × pod(30)\` = 30,000 combinations × 13 ≈ **390K series** for one metric. Add \`user_id\` with 1M users and you are at hundreds of billions — Prometheus OOMs long before that. A Prometheus head block uses roughly **1–4 KB RAM per active series**; a single well-provisioned instance is comfortable at a few million active series.

Where cardinality comes from:
- Raw URL paths (\`/orders/81723\`) instead of route templates (\`/orders/:id\`).
- IDs (user, order, session, trace), emails, IPs, error messages, full user-agent strings.
- Pod names in a fast-autoscaling or crash-looping deployment (each new pod = new series; old ones linger until they go stale).

Mitigations: bounded label allowlist in code reviews, route templates, \`status_class\` not raw status, \`metric_relabel_configs\` to drop labels, \`sample_limit\` per scrape target as a circuit breaker, recording rules to pre-aggregate away \`pod\`, and **put high-cardinality data on traces and logs** — they are designed for it. Exemplars let a histogram bucket point at a specific trace_id without making it a label.`,
      code: [
        {
          language: 'yaml',
          title: 'Prometheus scrape guardrails',
          code: `scrape_configs:
  - job_name: orders-api
    scrape_interval: 15s
    kubernetes_sd_configs:
      - role: pod
    # circuit breaker: the whole scrape fails if a target exposes more than 50K samples
    sample_limit: 50000
    label_limit: 30
    metric_relabel_configs:
      # drop labels someone added by mistake before they reach the TSDB
      - action: labeldrop
        regex: 'user_id|session_id|request_id'
      # drop an entire noisy metric family
      - source_labels: [__name__]
        regex: 'http_client_request_size_bytes_bucket'
        action: drop

# recording rule: pre-aggregate away 'pod' for long-lived dashboards
# - record: route:http_server_request_duration_seconds_bucket:rate5m
#   expr: sum by (le, route, status_class) (rate(http_server_request_duration_seconds_bucket[5m]))`,
        },
      ],
      keyPoints: [
        'Series count is multiplicative across labels.',
        'IDs belong on spans and logs, not metric labels.',
        'sample_limit, labeldrop and recording rules are the operational guardrails.',
      ],
    },
    {
      heading: 'Distributed tracing with OpenTelemetry (NestJS)',
      body: `**Intuition:** a trace is a parcel tracking history for a single request: every service stamps "received at, handed off at", so you can see exactly which depot sat on the parcel.

**Model:** a *trace* (128-bit trace_id) is a tree of *spans*. Each span has a span_id, parent span_id, name, start/end, kind (SERVER, CLIENT, PRODUCER, CONSUMER, INTERNAL), attributes (\`http.route\`, \`db.system\`), events and a status.

**Context propagation** is the whole game. The W3C Trace Context header:

\`traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01\`

= version \`00\` · 32-hex trace-id · 16-hex parent span-id · flags (\`01\` = sampled). \`tracestate\` carries vendor-specific data; \`baggage\` carries app key-values (e.g., tenant) — keep it small, it rides on every hop.

In Node, OpenTelemetry auto-instrumentation patches \`http\`, express/Nest, \`pg\`, \`ioredis\`, \`kafkajs\`, gRPC, and uses \`AsyncLocalStorage\` to keep the active context across \`await\`. **It must load before anything it patches** — import \`tracing.ts\` as the first line of \`main.ts\` or run \`node --require ./dist/tracing.js\`.

**Header propagation gotcha (Mastering API Ch 5):** a service mesh like Istio/Envoy creates spans for each hop, but it **cannot link inbound to outbound** calls inside your process — your app must forward the trace headers. Without it you get dozens of disconnected two-span traces.

Async boundaries (Kafka, SQS, cron → job) need explicit inject/extract into message headers; use a span *link* instead of a parent when one consumer batch processes messages from many traces.`,
      code: [
        {
          language: 'typescript',
          title: 'tracing.ts — load before NestFactory.create',
          code: `import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

const sdk = new NodeSDK({
  serviceName: 'orders-api',
  traceExporter: new OTLPTraceExporter({ url: 'http://otel-collector:4318/v1/traces' }),
  // respect the caller's sampling decision; sample 10% of new root traces
  sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.1) }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false }, // very noisy, rarely useful
    }),
  ],
});

sdk.start();

// flush buffered spans on shutdown or you lose the traces of the incident that killed the pod
process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});

// main.ts:  import './tracing';  // MUST be the first import
//           import { NestFactory } from '@nestjs/core'; ...`,
        },
        {
          language: 'typescript',
          title: 'Manual span + Kafka context propagation',
          code: `import { context, propagation, trace, ROOT_CONTEXT, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { Producer, Consumer } from 'kafkajs';

const tracer = trace.getTracer('orders');

export async function publishOrderCreated(producer: Producer, order: { id: string }) {
  const headers: Record<string, string> = {};
  propagation.inject(context.active(), headers); // writes traceparent (+ tracestate, baggage)
  await producer.send({
    topic: 'order-created',
    messages: [{ key: order.id, value: JSON.stringify(order), headers }],
  });
}

export async function runConsumer(consumer: Consumer, handle: (v: string) => Promise<void>) {
  await consumer.run({
    eachMessage: async ({ message }) => {
      const carrier: Record<string, string> = {};
      for (const [k, v] of Object.entries(message.headers ?? {})) {
        if (v !== undefined) carrier[k] = v.toString(); // kafkajs gives Buffers
      }
      const parentCtx = propagation.extract(ROOT_CONTEXT, carrier);
      await tracer.startActiveSpan('order-created process', { kind: SpanKind.CONSUMER }, parentCtx,
        async (span) => {
          try {
            await handle(message.value?.toString() ?? '');
          } catch (err) {
            span.recordException(err as Error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw err;
          } finally {
            span.end(); // un-ended spans are never exported
          }
        });
    },
  });
}`,
        },
      ],
      diagram: `traceparent: 00-4bf92f35...0e4736-00f067aa0ba902b7-01
              |   trace-id (same all hops) parent span   sampled

gateway [SERVER]  |==================================| 820ms
  orders [SERVER]    |=============================|   790ms
    pg SELECT          |==|                            12ms
    pricing [CLIENT]       |=====================|     610ms  <- critical path
      pricing [SERVER]      |===================|
        redis GET             |=|
        tax-api [CLIENT]         |==============|  560ms  <- culprit
    kafka send [PRODUCER]                        |=|`,
      keyPoints: [
        'Traces are only as good as propagation — every HTTP, gRPC and message hop must carry traceparent.',
        'Auto-instrumentation must be loaded first; flush on SIGTERM.',
        'Meshes create hop spans but your code must forward headers.',
      ],
      source: 'Mastering API Architecture — Ch 5 (header propagation, tracing)',
    },
    {
      heading: 'Sampling: head vs tail',
      body: `**Intuition:** you cannot keep a CCTV recording of every request forever. Head sampling decides at the door whether to record; tail sampling records everyone briefly and keeps only the interesting footage.

At 20K RPS × 30 spans × ~1 KB, 100% tracing is ~600 MB/s (~50 TB/day). You must sample.

| | Head sampling | Tail sampling |
|---|---|---|
| Where decided | Root service, at trace start (\`TraceIdRatioBasedSampler\`) | OTel Collector after the trace is complete (\`decision_wait\` ~10 s) |
| Knows outcome? | No — blind to errors/latency | Yes — keep all errors, slow traces, specific tenants |
| Cost | Near zero; unsampled spans never created | Every span exported to the collector; buffer memory = traces/s × wait × size |
| Consistency | Guaranteed via \`ParentBased\` + sampled flag | Needs **all spans of a trace on the same collector** (load-balancing exporter keyed by trace_id) |
| Failure mode | 1% sampling drops 99% of your rare errors | Collector OOM under spikes; late spans after decision are dropped |

Practical pattern: SDKs export 100% (or a generous head rate) → tier-1 collector (agents) → **loadbalancing exporter routed by traceID** → tier-2 collectors running \`tail_sampling\`: keep 100% of errors, 100% of traces over the latency SLO, and 1–5% probabilistic baseline. Derive RED metrics **before** sampling (spanmetrics connector) so metrics stay accurate even though traces are sampled.

Logs can be sampled with the same idea: keep every error and slow request, sample successful access logs.`,
      code: [
        {
          language: 'yaml',
          title: 'OTel Collector (tier 2) — tail sampling policies',
          code: `receivers:
  otlp:
    protocols:
      grpc: {}
processors:
  memory_limiter:            # protect the collector itself first
    check_interval: 1s
    limit_percentage: 80
  tail_sampling:
    decision_wait: 10s       # how long to buffer spans before deciding
    num_traces: 200000       # in-memory traces; size = traces/s x decision_wait
    policies:
      - name: keep-errors
        type: status_code
        status_code: { status_codes: [ERROR] }
      - name: keep-slow
        type: latency
        latency: { threshold_ms: 500 }
      - name: baseline
        type: probabilistic
        probabilistic: { sampling_percentage: 2 }
exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls: { insecure: true }
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, tail_sampling]
      exporters: [otlp/tempo]
# Tier-1 collectors use the 'loadbalancing' exporter with routing_key: traceID
# so every span of a trace reaches the same tier-2 instance.`,
        },
      ],
      keyPoints: [
        'Head = cheap and blind; tail = smart and stateful.',
        'Tail sampling requires trace-ID-affinity routing between collector tiers.',
        'Compute span metrics before sampling so RED numbers stay exact.',
      ],
    },
    {
      heading: 'SLI, SLO, SLA and error budgets',
      body: `**Intuition:** the SLO is the speed limit you set for yourself; the SLA is the fine the police (customer contract) will issue; the error budget is how many "speeding tickets" you can afford this month before you must slow down and fix reliability.

- **SLI** (indicator): a ratio of good events to valid events, e.g. "HTTP requests to /checkout that returned non-5xx in < 300 ms ÷ all valid requests". Measure as close to the user as possible (load balancer / gateway, or synthetic probes), because the app's own histogram never sees requests the LB rejected while pods were down.
- **SLO** (objective): target over a window, e.g. 99.9% over rolling 30 days.
- **SLA** (agreement): external contract with credits; always looser than the SLO (e.g., SLA 99.5%, SLO 99.9%) so you get warned first.
- **Error budget** = 1 − SLO. At 99.9% and 100M requests/month you may fail 100K requests. Policy: while budget remains, ship fast; when it is exhausted, freeze risky releases and spend engineering time on reliability.

| SLO | Allowed downtime per 30 days | Per year |
|---|---|---|
| 99% | 7.2 h | 3.65 days |
| 99.5% | 3.6 h | 1.83 days |
| 99.9% | 43.2 min | 8.76 h |
| 99.95% | 21.6 min | 4.38 h |
| 99.99% | 4.32 min | 52.6 min |

Availability composes multiplicatively for **serial** dependencies: five 99.9% services in a chain ≈ 99.5%. That is why critical paths need fewer hops, timeouts and graceful degradation.

Choose SLOs from user journeys (login, search, checkout), not per-pod metrics. Two to four SLIs per journey — availability and latency at minimum; freshness for pipelines; correctness for money.`,
      code: [
        {
          language: 'yaml',
          title: 'Recording rules for a request-based SLI (multiple windows)',
          code: `groups:
  - name: checkout-sli
    interval: 30s
    rules:
      # bad = 5xx OR slower than 300ms; valid = all requests except client errors
      - record: sli:checkout_bad:ratio_rate5m
        expr: |
          1 - (
            sum(rate(http_server_request_duration_seconds_bucket{service="checkout",le="0.3",status_class!~"5xx|4xx"}[5m]))
            /
            sum(rate(http_server_request_duration_seconds_count{service="checkout",status_class!="4xx"}[5m]))
          )
      - record: sli:checkout_bad:ratio_rate30m
        expr: |
          1 - (
            sum(rate(http_server_request_duration_seconds_bucket{service="checkout",le="0.3",status_class!~"5xx|4xx"}[30m]))
            /
            sum(rate(http_server_request_duration_seconds_count{service="checkout",status_class!="4xx"}[30m]))
          )
      # ...same expression for [1h], [6h], [3d]`,
        },
      ],
      keyPoints: [
        'SLI = good/valid, measured near the user.',
        '99.9% over 30 days = 43.2 minutes or 0.1% of requests.',
        'Error budget policy turns reliability into a product decision.',
      ],
      source: 'Google SRE Workbook — Ch 2 Implementing SLOs',
    },
    {
      heading: 'Burn-rate alerting: page on symptoms, not causes',
      body: `**Intuition:** instead of "the engine is at 80% RPM" (CPU > 80%), alert on "at this pace we will run out of fuel before the destination" (error budget exhausted before the month ends).

**Burn rate** = observed bad ratio ÷ budgeted bad ratio. With a 99.9% SLO (budget 0.1%), a sustained 1.44% error rate is a **14.4× burn** — the whole 30-day budget disappears in 30/14.4 ≈ 2.1 days.

Budget consumed = burn rate × (alert window ÷ SLO window). The SRE Workbook's multi-window, multi-burn-rate recipe:

| Severity | Long window | Short window | Burn rate | Budget consumed when it fires |
|---|---|---|---|---|
| Page | 1 h | 5 min | 14.4× | 2% |
| Page | 6 h | 30 min | 6× | 5% |
| Ticket | 3 days | 6 h | 1× | 10% |

- The **long window** gives significance (no paging on a 30-second blip).
- The **short window** makes the alert **reset quickly** once you fix it (otherwise the 1-hour average keeps firing for an hour after recovery).
- Low-traffic services: a handful of failures can blow the ratio — add a minimum request-count clause or use synthetic traffic.

Cause-based alerts (CPU, disk 90%, pod restarts) become **tickets or dashboard annotations**, not pages. Every page must be actionable and linked to a runbook and a dashboard. A full alerting design adds the plumbing: rules evaluated periodically, alert state stored, dedup/grouping/inhibition in Alertmanager, then fan-out to PagerDuty, Slack, email.`,
      code: [
        {
          language: 'yaml',
          title: 'Prometheus alert rules — multi-window multi-burn-rate (SLO 99.9%)',
          code: `groups:
  - name: checkout-slo-alerts
    rules:
      - alert: CheckoutErrorBudgetFastBurn
        # 14.4x burn: 2% of the 30-day budget gone in 1 hour
        expr: |
          sli:checkout_bad:ratio_rate1h > (14.4 * 0.001)
          and
          sli:checkout_bad:ratio_rate5m > (14.4 * 0.001)
        labels:
          severity: page
        annotations:
          summary: 'Checkout burning error budget at >14.4x (budget gone in ~2 days)'
          runbook_url: 'https://runbooks.internal/checkout-slo'
          dashboard: 'https://grafana.internal/d/checkout-red'
      - alert: CheckoutErrorBudgetSlowBurn
        # 6x burn: 5% of budget in 6 hours
        expr: |
          sli:checkout_bad:ratio_rate6h > (6 * 0.001)
          and
          sli:checkout_bad:ratio_rate30m > (6 * 0.001)
        labels:
          severity: page
      - alert: CheckoutErrorBudgetTicket
        expr: |
          sli:checkout_bad:ratio_rate3d > 0.001
          and
          sli:checkout_bad:ratio_rate6h > 0.001
        labels:
          severity: ticket`,
        },
      ],
      keyPoints: [
        'Burn rate = bad ratio / (1 − SLO).',
        '14.4× over 1h+5m and 6× over 6h+30m page; 1× over 3d is a ticket.',
        'Resource alerts become tickets; pages must be actionable with runbooks.',
      ],
      source: 'Google SRE Workbook — Ch 5 Alerting on SLOs; Alex Xu Vol 2 Ch 5 (alerting system)',
    },
    {
      heading: 'Designing the metrics pipeline at scale',
      body: `**Intuition:** a metrics platform is a write-heavy database for numbers that are almost always read as "the last few hours, aggregated".

The classic design for a large fleet: collection → transmission → storage → query → alerting/visualization.

**Pull vs push**

| | Pull (Prometheus) | Push (StatsD, OTLP push, CloudWatch agent) |
|---|---|---|
| Health signal | Failed scrape = target down (\`up == 0\`) | Silence is ambiguous |
| Short-lived jobs | Poor — needs Pushgateway | Natural |
| Network | Collector must reach every target (service discovery) | Works through NAT/firewalls |
| Back-pressure | Collector controls rate | Clients can flood the collector |

**Scaling the write path:** put **Kafka** between collectors and the TSDB to absorb spikes and decouple ingestion from storage outages; partition by metric name/labels so consumers can aggregate. Long-term storage: Mimir/Thanos/Cortex, VictoriaMetrics, M3, InfluxDB.

**Storage facts worth quoting:**
- Facebook's Gorilla paper: ~85% of queries hit the **last 26 hours** → keep recent data in memory/SSD, older on object storage.
- Delta-of-delta timestamp + XOR value encoding compresses a sample to ~1.37 bytes (Prometheus achieves ~1–2 bytes/sample).
- **Downsampling**: raw for 7 days, 1-minute resolution for 30 days, 1-hour for a year.
- Pre-aggregation in the collector trades flexibility for cost.

**Visualization & correlation**: Grafana over Prometheus, Tempo, Loki; exemplars on histograms link to traces; deploy annotations on every dashboard so "what changed?" is visible.

Buy vs build: most companies should buy or run the OSS stack; building a TSDB is only justified at hyperscale.`,
      diagram: `targets --(pull/scrape)--> collectors --> Kafka --> consumers --> TSDB
   ^  service discovery         |                  (aggregate)   (hot: SSD
   |  (k8s API / Consul)        |                                  cold: S3,
   |                            v                                  downsampled)
   |                     rule evaluator --> Alertmanager --> PagerDuty/Slack
   |                                                  ^
   +------ Grafana dashboards <--- query service -----+ (cache recent queries)`,
      keyPoints: [
        'Pull gives free liveness; push suits ephemeral jobs.',
        'Kafka buffers ingestion; recent data hot, old data downsampled on object storage.',
        'Most queries are about the last day — design storage tiers around it.',
      ],
      source: 'Alex Xu — System Design Interview Vol 2, Ch 5 Metrics Monitoring and Alerting System',
    },
    {
      heading: 'Controlling log volume and cost (Grafana Loki and friends)',
      body: `**Intuition:** logs grow with traffic × services × verbosity; bills grow with *ingest* and *index*. Most log bytes are successful requests nobody will ever read.

**Levers, in order of impact**
1. **Stop logging what metrics already tell you.** "Request completed 200 OK" × 20K RPS is a counter, not 1.7 billion log lines/day.
2. **Sample successful access logs** (e.g., 1–5%) but keep **100% of errors, slow requests and audit events**. Make the decision per request (so a request's lines are all kept or all dropped), ideally keyed on the trace sampling decision.
3. **Levels & dynamic verbosity**: INFO in prod; flip one service/tenant to DEBUG for 15 minutes via config, not a redeploy.
4. **Trim payloads**: never log full request/response bodies; cap field sizes; drop stack traces for expected errors.
5. **Tiered retention**: 7–15 days hot/searchable, then compressed object storage (S3/GCS) for 90 days–7 years for compliance.
6. **Drop at the pipeline**: Vector/Fluent Bit/OTel Collector filters for noisy health-check or kube-probe logs.

**Loki vs Elasticsearch**: Loki indexes only **labels** and stores compressed chunks in object storage, so it is 10×-ish cheaper to ingest, but queries scan chunks. Keep Loki labels low-cardinality (\`service\`, \`env\`, \`namespace\`, \`level\`) and put \`trace_id\`/\`user_id\` in the log body (Loki 3 structured metadata also works). Elasticsearch indexes every field: fast arbitrary search, far more expensive storage and heap.`,
      code: [
        {
          language: 'typescript',
          title: 'Access-log sampler: keep every error and slow request, sample the rest',
          code: `import { trace } from '@opentelemetry/api';
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

const SUCCESS_SAMPLE_RATE = Number(process.env.ACCESS_LOG_SAMPLE ?? '0.02'); // 2%
const SLOW_MS = 500;

export function accessLog(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    const traceSampled = (trace.getActiveSpan()?.spanContext().traceFlags ?? 0) & 1;
    const interesting = res.statusCode >= 500 || latencyMs > SLOW_MS;
    // align with trace sampling so a kept trace always has its logs
    if (!interesting && !traceSampled && Math.random() > SUCCESS_SAMPLE_RATE) return;
    const entry = { route: req.route?.path, method: req.method, status: res.statusCode, latency_ms: Math.round(latencyMs) };
    if (res.statusCode >= 500) logger.error(entry, 'request failed');
    else if (latencyMs > SLOW_MS) logger.warn(entry, 'slow request');
    else logger.info(entry, 'request');
  });
  next();
}`,
        },
        {
          language: 'text',
          title: 'LogQL — low-cardinality stream selector, then filter & parse',
          code: `# find timeouts for one tenant in orders, parsing JSON body fields
{service="orders-api", env="prod", level="error"} |= "timeout" | json | tenant_id="acme"

# jump from a trace to its logs
{env="prod"} | json | trace_id="4bf92f3577b34da6a3ce929d0e0e4736"

# log-derived metric: error lines per route over 5m
sum by (route) (count_over_time({service="orders-api", level="error"} | json [5m]))`,
        },
      ],
      keyPoints: [
        'Replace high-volume logs with metrics; sample successes; keep all errors.',
        'Loki labels must be low-cardinality; IDs go in the body.',
        'Hot 7–15 days, cold on object storage.',
      ],
    },
    {
      heading: 'Reading signals: a debugging playbook for 20+ microservices',
      body: `**Intuition:** debugging distributed systems is a funnel — start wide at the user symptom, narrow by dimension, then drill into one trace and one log line. Guessing at random services is how incidents last four hours.

**The funnel**
1. **Symptom**: which SLO is burning? Which journey, since when? Check deploy/config/feature-flag annotations first — ~70% of incidents follow a change.
2. **Mitigate before root-causing**: if it correlates with a release, roll back or turn the flag off (Mastering API Ch 5: separate deploy from release so this is cheap).
3. **Localize with RED splits**: by \`version\`, \`pod\`, \`zone\`, \`route\`, \`tenant\`, \`status_class\`. One pod bad → node/noisy neighbour; one version bad → code; one zone → infra; one tenant → data shape/hot key.
4. **Service graph / critical path**: trace-derived dependency map shows which edge's latency grew. Remember **self time vs total time** — the service at the top always "looks slow".
5. **Exemplar → trace → logs**: open a slow trace from the p99 bucket, find the widest span on the critical path, query logs by \`trace_id\`.
6. **USE on the culprit**: pool waits, event-loop lag, GC pauses, threadpool, downstream rate limits, lock waits.
7. **Profile** if it is CPU: flame graph from continuous profiling.

| Symptom | Likely causes | Signal that proves it |
|---|---|---|
| Slow, CPU normal | Waiting: DB pool, downstream, locks, DNS, libuv threadpool, retries with backoff | Pool waiting gauge, client span durations, event-loop lag |
| DB healthy, API slow | Pool exhaustion, N+1 queries, big serialization, network/TLS handshakes | Many short pg spans per trace; pool wait; JSON serialize span |
| One of 20 services | Shared downstream, retry storm, hot partition | Service graph edge latency, retries counter |
| Errors after deploy | New code path, config, schema/contract mismatch | \`sum by (version)\` of 5xx, new error messages in logs |
| Mean flat, p99 up | GC, one bad pod, cache misses for a subset | Heatmap, per-pod p99 |`,
      diagram: `SLO burn alert
    |
    v
RED dashboard --split by--> version | pod | zone | route | tenant
    |
    v
service graph (which edge got slower?)
    |
    v
exemplar on p99 bucket --> trace (critical path, widest span)
    |                               |
    v                               v
logs {trace_id=...}          USE of that resource / profile flame graph`,
      keyPoints: [
        'Check what changed; mitigate first, root-cause second.',
        'Split RED by dimensions to localize before opening traces.',
        'Use critical path and self-time, not total time, to find the culprit.',
      ],
      source: 'Mastering API Architecture — Ch 5 (reading the signals)',
    },
  ],
  codeChallenges: [
    {
      id: 'observability-cc-1',
      title: 'Fix the metrics middleware that took down Prometheus',
      context:
        'A teammate added latency metrics to the orders API. A week later Prometheus is OOM-killing every few hours, the "p99 latency" dashboard disagrees with the load balancer by 4×, and the requests-per-second panel shows nonsense after every deploy.',
      task:
        'Rewrite the instrumentation so it is safe to run on 40 pods at 5K RPS each, produces a correct fleet-wide p99 and error ratio, and can drive a 300 ms latency SLO.',
      starter: {
        language: 'typescript',
        code: `import { Gauge, Summary } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

const requestCount = new Gauge({
  name: 'http_requests',
  help: 'requests served',
  labelNames: ['path', 'status', 'user_id'],
});

const latency = new Summary({
  name: 'http_latency_ms',
  help: 'latency',
  labelNames: ['path', 'status', 'user_id', 'error'],
  percentiles: [0.5, 0.99],
});

export function metrics(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  next();
  // record right after the handler is invoked
  const labels = {
    path: req.originalUrl,                    // e.g. /orders/81723?expand=items
    status: String(res.statusCode),
    user_id: String(req.header('x-user-id')),
    error: res.statusMessage,
  };
  requestCount.inc(labels);
  latency.observe(labels, Date.now() - start);
}

// dashboard: avg(http_latency_ms{quantile="0.99"})`,
      },
      hints: [
        'Count how many unique label combinations path, user_id and error produce. Where should per-user data live instead?',
        'When does next() return relative to the response being sent in an async handler? What happens to a Gauge when a pod restarts?',
        'Can you combine 40 pods\' pre-computed p99s into one fleet p99? Which metric type can be summed across instances?',
      ],
      solution: {
        language: 'typescript',
        code: `import { Counter, Histogram } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

// Histogram gives _count (use for rate/error ratio), _sum and aggregatable buckets.
const httpDuration = new Histogram({
  name: 'http_server_request_duration_seconds', // base unit: seconds
  help: 'Server-side request latency',
  labelNames: ['method', 'route', 'status_class'] as const, // all bounded
  buckets: [0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2.5, 5], // 0.3 = SLO threshold
});

// Optional business counter; monotonic, so rate() survives restarts.
const httpErrors = new Counter({
  name: 'http_server_errors_total',
  help: 'Responses with status >= 500',
  labelNames: ['route'] as const,
});

export function metrics(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint(); // monotonic clock, immune to NTP jumps
  res.on('finish', () => {
    // runs after the response is fully written, including exception-filter status codes
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route?.path ? req.baseUrl + req.route.path : 'unmatched';
    const statusClass = Math.floor(res.statusCode / 100) + 'xx';
    httpDuration.observe({ method: req.method, route, status_class: statusClass }, seconds);
    if (res.statusCode >= 500) httpErrors.inc({ route });
  });
  next();
}

// Fleet p99 (sum buckets across pods first):
// histogram_quantile(0.99, sum by (le, route) (rate(http_server_request_duration_seconds_bucket[5m])))
// SLI: sum(rate(..._bucket{le="0.3",status_class!="5xx"}[5m])) / sum(rate(..._count[5m]))
// Per-user / per-order detail goes on trace span attributes and logs, not labels.`,
      },
      explanation: `**Fixes**
- **Cardinality**: \`originalUrl\` (IDs + query strings), \`user_id\` and free-text \`statusMessage\` made the series count unbounded — the OOM cause. Replaced with the route template, \`method\` and \`status_class\` (≈ 4 × 50 × 5 = 1K combinations × 13 series).
- **Wrong timing**: \`next()\` returns as soon as an async handler *starts*; latency was ~0 and the status code was still 200. Measuring in \`res.on('finish')\` captures the real duration and final status.
- **Gauge as a counter**: gauges reset silently on restart and cannot be used with \`rate()\`; the histogram's \`_count\` is a proper counter that \`rate()\` handles across resets.
- **Summary quantiles are not aggregatable**: \`avg(quantile="0.99")\` across 40 pods is mathematically meaningless (hence the 4× disagreement). Histogram buckets sum across pods, then \`histogram_quantile\` gives the true fleet p99.
- **SLO-ready buckets**: an exact \`0.3\` boundary lets you count good requests precisely; base unit seconds follows Prometheus conventions; \`hrtime\` is monotonic unlike \`Date.now()\`.
- Per-request detail (user, order) moved to traces/logs where high cardinality is cheap.`,
      followUps: [
        {
          "q": "How would you stop this mistake from ever reaching Prometheus again, even if another team writes similar middleware?",
          "a": "Use several layers. In CI, run a unit test that hits 1,000 random URLs through the middleware and asserts the registry has fewer than N series. In code review, have a lint rule that flags `req.url`/`originalUrl` and `user` in metric label values. At scrape time, set `sample_limit` per target (for example 20K) and `label_limit`/`label_value_length_limit`, so a regression fails one target loudly instead of OOMing Prometheus. Alert on `scrape_samples_post_metric_relabeling` growth and on per-job `prometheus_tsdb_head_series`. Per-team series quotas in Mimir enforce the budget centrally."
        },
        {
          "q": "Some routes are WebSocket upgrades and server-sent events that stay open for 30 minutes. What does this middleware record for them, and how do you fix it?",
          "a": "`finish` fires when the long-lived response finally ends, so the latency histogram gets 1,800 s observations that destroy the route's p99. With `res.on('finish')` never firing on abrupt disconnects, some aren't recorded at all. Exclude streaming routes from the request-duration histogram (match on the upgrade header or a route allowlist) and instrument them differently: time-to-first-byte or time-to-first-event as the latency SLI, a gauge of open connections, and counters of messages and disconnect reasons. Also listen to `close` as well as `finish` for aborted requests."
        }
      ],
    },
    {
      id: 'observability-cc-2',
      title: 'Make logs and traces follow the request across services',
      context:
        'The payments service logs are "useless during incidents": logs from concurrent requests show the wrong request ID, the downstream fraud-service traces start fresh roots instead of joining the payment trace, and security found card numbers in the log store.',
      task:
        'Refactor so every log line carries the correct request/trace IDs under concurrency, the outbound call joins the same trace, and sensitive data never reaches the log pipeline.',
      starter: {
        language: 'typescript',
        code: `import express from 'express';
import { randomUUID } from 'node:crypto';

let currentRequestId = '';            // "global context"

function log(msg: string, data?: unknown) {
  console.log(new Date().toISOString() + ' [' + currentRequestId + '] ' + msg + ' ' + JSON.stringify(data));
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  currentRequestId = randomUUID();    // new id per request
  next();
});

app.post('/payments', async (req, res) => {
  log('payment request', req.body);   // includes card.number, cvv
  const fraud = await fetch('http://fraud-service/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount: req.body.amount, userId: req.body.userId }),
  });
  const score = await fraud.json();
  log('fraud score', score);
  res.json({ ok: true });
});

app.listen(3000);`,
      },
      hints: [
        'Two requests interleave at the await on fetch — which ID does the second log() print?',
        'Node has a built-in way to carry per-request context across await boundaries. OpenTelemetry uses it too.',
        'What header must the outbound request carry for fraud-service to continue the same trace, and where should redaction happen so no one can forget it?',
      ],
      solution: {
        language: 'typescript',
        code: `import './tracing'; // OTel NodeSDK with http/express/undici auto-instrumentation, loaded FIRST
import express from 'express';
import pino from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { context, propagation, trace } from '@opentelemetry/api';

const als = new AsyncLocalStorage<{ requestId: string }>();
const logger = pino({
  base: { service: 'payments' },
  redact: { paths: ['body.card', 'body.cvv', 'headers.authorization'], censor: '[REDACTED]' },
  mixin: () => ({
    request_id: als.getStore()?.requestId,
    trace_id: trace.getActiveSpan()?.spanContext().traceId,
  }),
});

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[\\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', requestId);
  als.run({ requestId }, next); // context survives every await in this request
});

app.post('/payments', async (req, res) => {
  // log an allowlisted view, never the raw body
  logger.info({ amount: req.body.amount, currency: req.body.currency }, 'payment request');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-request-id': als.getStore()!.requestId,
  };
  propagation.inject(context.active(), headers); // traceparent (auto-instr also does this for fetch)
  const fraud = await fetch('http://fraud-service/score', {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount: req.body.amount, userId: req.body.userId }),
    signal: AbortSignal.timeout(800), // bounded wait shows up as an error span, not a hang
  });
  const score = (await fraud.json()) as { score: number };
  logger.info({ fraud_score: score.score, fraud_status: fraud.status }, 'fraud scored');
  res.json({ ok: true });
});

app.listen(3000);`,
      },
      explanation: `**Fixes**
- **Race on global state**: a module-level \`currentRequestId\` is overwritten by the next request while the first awaits \`fetch\`, so logs get mis-attributed. \`AsyncLocalStorage.run\` scopes context per request across every \`await\`.
- **Structured JSON logs** via pino (async, fast) instead of string concatenation with \`console.log\`, so fields are queryable and \`trace_id\` is always present through \`mixin\`.
- **Trace continuity**: loading OTel first and injecting \`traceparent\` (plus \`x-request-id\`) on the outbound call makes fraud-service continue the same trace instead of starting a new root.
- **PII/PCI**: raw body logging leaked card data (a PCI-DSS violation). Log an allowlisted projection and add logger-level \`redact\` as defence in depth.
- **Timeout** on the downstream call so a slow dependency becomes a visible error span and bounded latency rather than a hung request; body size limit bounds log/processing cost.`,
      followUps: [
        {
          "q": "Payments also publishes a `payment.completed` event to Kafka, processed by a ledger service. Extend the design so logs and traces stay correlated there.",
          "a": "At produce time, inject the active context into the Kafka record headers with `propagation.inject(context.active(), headers)`, and add `x-request-id` from AsyncLocalStorage as a header. In the ledger consumer, extract both and wrap processing in `als.run({ requestId }, ...)` inside a CONSUMER span parented to, or linked to, the extracted context. Then pino's mixin stamps the same `request_id` and `trace_id` on ledger logs. Searching one request ID now returns the HTTP request, the fraud call and the asynchronous ledger write, even though they happened seconds apart in different processes."
        },
        {
          "q": "How would you prove in a test that concurrent requests never get mixed-up request IDs?",
          "a": "Write an integration test with supertest: stub `fetch` to fraud-service with random delays (0–50 ms) so awaits interleave, fire 200 concurrent POSTs each with a distinct `x-request-id`, and capture pino output into an in-memory stream. Assert that each log line's `request_id` matches the ID of the request that produced it (log the incoming ID and a nonce from the body), and that the response header echoes the right ID. Run it against the old global-variable code to confirm it fails. That proves the test actually detects the race."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'observability-iq-01',
      difficulty: 'hard',
      question:
        'Your NestJS orders API p99 went from 120 ms to 1.8 s, but CPU across all pods is at 25% and memory is flat. Walk me through how you find the cause.',
      context: 'Node 20 on Kubernetes, 30 pods, Postgres via pg.Pool (max 10 per pod), Redis, two downstream HTTP services.',
      whatInterviewerLooksFor: [
        'Recognizes low CPU + high latency = time spent waiting (off-CPU), not computing',
        'Checks saturation of non-CPU resources: DB pool, HTTP agent sockets, libuv threadpool, event loop',
        'Uses traces to split latency into self time vs downstream time',
        'Knows Node-specific traps: per-core CPU vs average, event-loop lag, sync crypto/zlib',
        'Mitigates before perfect root cause',
      ],
      modelAnswer: `### Frame it
Low CPU with high latency means requests are **waiting**, not working. My job is to find *what* they wait on.

### 1. Scope (2 minutes)
- When did it start, and what changed? Deploy/config/flag annotations, traffic mix, a downstream release.
- Is it all routes or one? Split p99 by \`route\`, \`pod\`, \`version\`. All pods equally → shared dependency; one pod → node/neighbour.

### 2. Check the CPU number itself
Node is single-threaded: a pod with 4 vCPUs at "25%" may be **one core at 100%**. I look at \`nodejs_eventloop_lag_p99_seconds\` — if it is 500 ms+, the loop is blocked (sync JSON of a huge payload, \`bcrypt\` sync, regex backtracking) even though the average looks idle.

### 3. Saturation (USE) of waiting resources
- **DB pool**: \`pool.waitingCount\` > 0 and acquire time rising. 30 pods × 10 = 300 connections; if one slow query holds connections for 1 s, a pool of 10 serves only 10 RPS per pod and everything else queues.
- **HTTP client**: agent \`maxSockets\`, missing keep-alive (TLS handshake each call), DNS lookups going through the 4-thread libuv pool.
- **Downstream latency and retries**: client span durations; a retry policy of 3 × 500 ms timeout turns one slow dependency into 1.5 s.
- **Locks**: Postgres \`pg_stat_activity\` wait events (\`Lock\`, \`ClientRead\`).

### 4. Traces for proof
Open exemplar traces from the slow bucket: the gap between the SERVER span start and the first \`pg\` span is pool wait; long CLIENT spans point at downstream; big gaps with no child spans suggest event-loop blocking or GC.

### 5. Mitigate, then fix
Shed load or roll back the change; raise the timeout budget carefully; then fix the root (index the slow query, cap payloads, move CPU work to worker threads). Add the missing saturation metric and an alert so the next time is a 2-minute diagnosis.`,
      followUps: [
        {
          q: 'Traces show a 900 ms gap before the first DB span, and no child spans in it. What is it?',
          a: 'Either waiting for a pool connection (if pg instrumentation starts the span at query, not acquire) or the event loop being blocked. Check pool waitingCount and event-loop lag at the same timestamps; add a manual span around pool.connect() to make acquire time visible.',
        },
        {
          q: 'Pool waiting is high. Do you just raise max connections to 50?',
          a: 'No: 30 pods × 50 = 1,500 connections would overwhelm Postgres (each backend ~5–10 MB, context switching). Find why connections are held long (slow query, transaction left open across an HTTP call), fix that, and use PgBouncer in transaction mode if you truly need more clients.',
        },
        {
          q: 'How would you have caught this before users did?',
          a: 'A latency SLO burn-rate alert on checkout, plus ticket-level alerts on pool saturation and event-loop lag p99 > 100 ms, and deploy annotations on the dashboard.',
        },
      ],
      pitfalls: [
        'Concluding "not a CPU problem, so scale out" — more pods can increase DB contention.',
        'Looking only at average latency or average CPU.',
        'Blaming the database because it is the usual suspect, without checking pool wait vs query time.',
      ],
    },
    {
      id: 'observability-iq-02',
      difficulty: 'expert',
      question:
        'We deployed v2.14 of the checkout service 20 minutes ago. The 5xx rate went from 0.1% to 0.6% and p99 latency increased by 40%. You are on call. What do you do, minute by minute?',
      whatInterviewerLooksFor: [
        'Mitigation first (rollback / flag off), with a decision made from data, not panic',
        'Uses version labels and canary vs baseline comparison',
        'Understands error-budget impact numerically',
        'Separates correlation from causation (was the deploy the only change?)',
        'Follows up with a blameless postmortem and prevention (automated canary analysis)',
      ],
      modelAnswer: `### Minutes 0–3: confirm and size it
- The burn-rate alert: 0.6% bad against a 99.9% SLO = **6× burn** → 5% of the monthly budget in 6 hours; worth acting on now, not an emergency page at 14.4×.
- \`sum by (version) (rate(..._count{status_class="5xx"}[5m]))\` — is the error coming **only from v2.14 pods**? If rollout is partial (say 50%), comparing v2.13 vs v2.14 pods is a built-in A/B test.
- Check other changes in the window: config pushes, flag flips, downstream deploys, a traffic spike. The deploy is the prime suspect, not the only one.

### Minutes 3–6: mitigate
If errors are concentrated on v2.14, **roll back** (or disable the feature flag if the change is flag-guarded — faster and safer). Don't debug in production while users bleed budget. Announce in the incident channel: impact, action, next update time.

### Minutes 6–20: verify and investigate
- Confirm recovery: the short-window burn rate (5m/30m) should drop within minutes; that is why multi-window alerts exist.
- Root cause from telemetry: group error logs of v2.14 by message/exception type; open exemplar traces for failed requests — which span errors? Typical culprits: new downstream call without timeout, schema/contract mismatch (field renamed), a new N+1 query raising latency, connection-pool size changed in config.
- Latency +40% with errors suggests a slow dependency causing timeouts, or retries amplifying.

### After
- Blameless postmortem: timeline, budget consumed (~0.5% × traffic × 20 min), detection time.
- Prevention: automated canary analysis (Argo Rollouts/Flagger comparing error ratio and p99 of canary vs baseline and aborting automatically), contract tests, and requiring new code paths behind flags so release is decoupled from deploy.`,
      followUps: [
        {
          q: 'The rollback finished but errors are still at 0.6%. Now what?',
          a: 'The deploy was not the cause (or it caused persistent side effects like bad data or a migration). Widen the search: downstream changes, infra events, data migrations that ran with the deploy, cache poisoning. Check if errors are on a specific route/tenant and follow the traces to the failing span.',
        },
        {
          q: 'Errors appear on both old and new pods. How could the new version still be responsible?',
          a: 'Shared state: v2.14 wrote records in a new format old pods cannot parse, published incompatible events, ran a DB migration (locks, dropped column), or its retry behaviour overloaded a shared dependency that all pods use.',
        },
        {
          q: 'How would you make this detection automatic?',
          a: 'Canary with automated analysis on SLI queries (error ratio, p99) per version, with thresholds relative to baseline, auto-abort, and deploy markers on dashboards. Details belong to the deployment pipeline design.',
        },
      ],
      pitfalls: [
        'Starting to read code before mitigating.',
        'Rolling back blindly without checking if errors are version-specific.',
        'Looking at aggregate dashboards only, with no version dimension.',
      ],
    },
    {
      id: 'observability-iq-03',
      difficulty: 'expert',
      question:
        'A request goes through 20 microservices and end-to-end latency doubled. Every team says "our service dashboard looks fine". How do you find the bottleneck?',
      whatInterviewerLooksFor: [
        'Distributed tracing with critical-path analysis rather than per-service dashboards',
        'Understands self time vs total time and fan-out amplification',
        'Service graph / span metrics to find which edge regressed',
        'Considers systemic causes: retries, queuing, shared dependencies, missing propagation',
      ],
      modelAnswer: `### Why dashboards disagree with users
Each team looks at its **own server-side** latency, often an average, often excluding time queued before their handler. A 20-hop chain can double end-to-end while each service moves only slightly, or the time is spent **between** services (queues, connection setup, retries, sidecars).

### Step 1 — traces, not dashboards
- Ensure propagation is intact: broken \`traceparent\` forwarding gives disconnected fragments. Check the percentage of traces with missing parents.
- Compare **trace-derived span metrics** (spanmetrics connector or Tempo metrics-generator) before/after: p99 per edge (caller → callee). The service graph highlights the edge whose latency grew.

### Step 2 — critical path
For slow exemplar traces, compute the critical path: the chain of spans that actually determines end-to-end time. Parallel calls off the critical path don't matter. Rank services by **self time** on the critical path, not total time — the gateway always has the largest total.

### Step 3 — look at the gaps
- CLIENT span much longer than the matching SERVER span → network, DNS, TLS handshakes, sidecar, or the callee's queue before the handler (pool/thread saturation).
- Repeated sibling CLIENT spans → **retries** or **N+1 fan-out**; one service retrying 3× at each of 3 layers can cause 27× load amplification.
- Kafka hops: producer-to-consumer lag shows as a gap between PRODUCER and CONSUMER spans.

### Step 4 — fan-out math
If a page fans out to 20 backends in parallel, its latency is the **max** of 20: with each service's p99 at 200 ms, ~18% of pages hit at least one p99. A small regression in one service's tail shows up big for the user. Fixes: hedged requests, tighter timeouts, caching, reducing fan-out.

### Step 5 — confirm and fix
Once a culprit is found, use that service's USE metrics/profiling; fix and add an SLO for that dependency with a latency budget per hop (e.g., total 500 ms budget split across the chain with deadline propagation).`,
      followUps: [
        {
          q: 'Half of the services are not instrumented. What can you still do?',
          a: 'Mesh-level spans and metrics (Envoy/Istio) give per-hop latency even without app instrumentation, though they cannot link inbound to outbound calls inside the service; compare edge latency in the mesh, and prioritize OTel auto-instrumentation on critical-path services.',
        },
        {
          q: 'The culprit is a shared Redis cluster used by 8 services. Nobody owns it. How do you prove it?',
          a: 'Show redis CLIENT spans p99 rising across all 8 callers at the same timestamp, correlate with Redis SLOWLOG, CPU on the main thread, big keys, evictions or a hot shard, and network saturation on its nodes.',
        },
        {
          q: 'How do you stop this recurring?',
          a: 'Latency budgets per hop, deadline propagation (gRPC deadlines), retry budgets instead of per-layer retries, and dependency SLOs with alerting on edge latency from span metrics.',
        },
      ],
      pitfalls: [
        'Asking each team to check their dashboards (the problem sits between the dashboards).',
        'Blaming the service with the largest total span duration (usually the root).',
        'Ignoring retries and queuing as sources of latency.',
      ],
    },
    {
      id: 'observability-iq-04',
      difficulty: 'hard',
      question:
        'The DBA shows you Postgres is healthy: CPU 30%, p99 query time 4 ms. Yet the API endpoint that runs those queries has p99 of 1.2 s. Explain the possible gaps and how you prove which one it is.',
      whatInterviewerLooksFor: [
        'Knows DB-side time excludes pool wait, network, and round trips',
        'Identifies N+1 query patterns via trace span counts',
        'Considers app-side costs: serialization, ORM hydration, event-loop blocking',
        'Proposes instrumentation to close the visibility gap',
      ],
      modelAnswer: `### What the DB metric does not include
Postgres measures **execution time per statement**. The API's time also includes:
1. **Pool acquire wait** — clients queued in \`pg.Pool\` because connections are busy (or held by an open transaction waiting on an HTTP call).
2. **Round trips × count** — an **N+1**: 300 queries at 4 ms each = 1.2 s, while every single query looks "fast". The DB is fine; the access pattern is not.
3. **Network and connection setup** — new connections per request (no pooling, serverless), TLS handshakes, cross-AZ hops (~1–2 ms each way, multiplied by N).
4. **App-side work** — ORM hydration of 50K rows, \`JSON.stringify\` of a 20 MB response blocking the event loop, GraphQL resolvers without DataLoader.
5. **Locks and idle-in-transaction** — the query waits on a lock; some DB dashboards count only active execution.

### How to prove it
- **Trace one slow request**: count \`pg\` spans. 300 child spans = N+1. One 4 ms span with a 1 s gap before it = pool wait or event-loop block.
- **Pool metrics**: \`waitingCount\`, \`totalCount\`, \`idleCount\`, and a histogram of acquire time; compare \`idle in transaction\` sessions in \`pg_stat_activity\`.
- **Event-loop lag** and a CPU profile around serialization.
- **Response size** histogram per route.

### Typical fixes
- N+1 → joins, \`WHERE id = ANY($1)\`, DataLoader batching in GraphQL resolvers.
- Pool wait → never hold a transaction across a remote call, shorten transactions, right-size pools with PgBouncer.
- Serialization → paginate, project only needed columns, stream large responses.

The lesson: measure time **from the client's point of view** (CLIENT spans and pool acquire), not just server-side DB time.`,
      followUps: [
        {
          q: 'It is an N+1 in a GraphQL resolver. What is the fix?',
          a: 'A request-scoped DataLoader that batches all keys requested in one tick into a single WHERE id = ANY($1) query and caches per request; verify by the pg span count dropping from N+1 to 2.',
        },
        {
          q: 'How would you detect N+1s automatically across all services?',
          a: 'Span-metrics or a trace-analysis rule: alert/report when a single trace has more than, say, 50 DB spans with the same statement template; some APMs flag this natively.',
        },
      ],
      pitfalls: [
        'Accepting "DB is healthy" as proof the data layer is not involved.',
        'Increasing pool size as a first move.',
        'Not distinguishing per-query latency from per-request total DB time.',
      ],
    },
    {
      id: 'observability-iq-05',
      difficulty: 'hard',
      question:
        'Our log bill is $140K/month and growing faster than traffic. Engineers still say they cannot find anything during incidents. How do you fix both problems?',
      whatInterviewerLooksFor: [
        'Quantifies where volume comes from before cutting',
        'Moves high-volume signals to metrics; samples successes, keeps errors',
        'Structured logs with trace_id so fewer logs are more useful',
        'Retention tiering and index/label strategy',
        'Governance: budgets per team, dynamic log levels',
      ],
      modelAnswer: `### 1. Measure before cutting
Break down ingest by \`service\`, \`level\` and message template. Typically **a few templates are 60–80% of bytes**: per-request "completed" lines, health-check/kube-probe logs, debug left on, full request/response bodies, stack traces for expected 404s.

### 2. Replace, sample, drop
- **Replace with metrics**: request counts and latency are histogram metrics — a single series replaces billions of lines.
- **Sample successful access logs** at 1–5%, keep **100% of errors, slow requests (> SLO), and audit events**; align with the trace sampling flag so kept traces have logs.
- **Drop** probes and noisy libraries in the pipeline (Vector/Fluent Bit/OTel Collector), cap field sizes, strip bodies.
- **Levels**: INFO by default, DEBUG toggled per service or per tenant for 15 minutes via config.

### 3. Store smarter
- Loki-style: index only low-cardinality labels, chunks on object storage (much cheaper than indexing every field in Elasticsearch).
- **Retention tiers**: 7–14 days searchable, 90 days+ compressed in S3 for compliance, rehydrate on demand.

### 4. Make remaining logs findable
- Mandatory JSON schema: \`service\`, \`version\`, \`trace_id\`, \`request_id\`, \`tenant_id\`, \`route\`, \`error.type\`.
- Link from traces to logs by \`trace_id\` in Grafana; from metrics via exemplars. People stop grepping and start navigating.

### 5. Governance
Per-team ingest budgets and dashboards showing cost per service; lint rules against logging in hot loops; review new log lines like new metrics.

**Result**: 60–80% volume reduction is normal, and incidents get *faster* because the signal-to-noise ratio improves.`,
      followUps: [
        {
          q: 'Compliance needs every payment API call recorded for 7 years. Does sampling break that?',
          a: 'Audit logs are a separate stream with a strict schema, never sampled, written to append-only/WORM storage (S3 Object Lock) with long retention — not the operational log pipeline.',
        },
        {
          q: 'During an incident you need DEBUG logs from one service. How, without redeploying?',
          a: 'A dynamic log-level endpoint or config flag (e.g., watched ConfigMap or feature flag) scoped by service/tenant with auto-expiry, so it cannot be left on and blow the budget.',
        },
      ],
      pitfalls: [
        'Cutting retention to 1 day as the only lever.',
        'Sampling errors along with successes.',
        'Putting trace_id/user_id as Loki labels (cardinality explosion in the index).',
      ],
    },
    {
      id: 'observability-iq-06',
      difficulty: 'expert',
      question:
        'Define SLOs and an alerting strategy for a payments API that processes 50M requests/month. The current setup pages on CPU > 80% and on any 5xx, and on-call gets ~40 pages a week.',
      whatInterviewerLooksFor: [
        'Picks user-centric SLIs and measures at the right point',
        'Computes error budget concretely',
        'Uses multi-window, multi-burn-rate alerts with correct math',
        'Demotes cause-based alerts; every page actionable',
        'Error budget policy tying reliability to release velocity',
      ],
      modelAnswer: `### SLIs (per user journey: authorize, capture, refund)
- **Availability**: non-5xx (and non-timeout) responses ÷ valid requests, measured at the **gateway/load balancer** so requests that never reached a pod count.
- **Latency**: share of requests under 400 ms (a bucket boundary at 0.4 s).
- **Correctness** (async): % of payments reconciled with the PSP within 1 hour.

### SLOs and budget
- Availability 99.95% over rolling 28–30 days; latency 99% under 400 ms.
- 50M × 0.05% = **25,000 failed requests/month** allowed, or ~21.6 minutes of full outage.
- The external SLA (e.g., 99.9%) stays looser than the internal SLO.

### Alerts
Burn rate = bad ratio ÷ 0.0005.
- **Page**: burn > 14.4 over 1 h *and* 5 min (≥ 0.72% errors) → 2% of budget burned in an hour.
- **Page**: burn > 6 over 6 h *and* 30 min (≥ 0.3% errors) → 5% burned.
- **Ticket**: burn > 1 over 3 days *and* 6 h.
- Low-traffic hours: require a minimum request count so 3 failures at 3 AM do not page.

### Demote the noise
- CPU > 80%, pod restarts, disk 85% → tickets or autoscaling signals, not pages. A payments API can run at 90% CPU and meet its SLO.
- "Any 5xx" → removed; the SLO absorbs expected noise.
- Group and deduplicate in Alertmanager; inhibit child alerts when a dependency alert fires.
- Every page links a runbook and dashboard; review pages weekly and delete or fix any non-actionable one.

### Error budget policy
Budget > 50% left → normal releases. Budget exhausted → freeze non-critical releases, reliability work prioritized, postmortem for any single incident consuming > 20%.

Expected outcome: from ~40 pages/week to a few per month, each representing real user pain.`,
      followUps: [
        {
          q: 'Why the short window in each burn-rate alert?',
          a: 'It makes the alert reset quickly after mitigation; without it, a 1-hour window keeps firing for up to an hour after the problem is fixed, and it also prevents firing on an old spike that has already ended.',
        },
        {
          q: 'A dependency (the card network) causes most failures. Should those count against your SLO?',
          a: 'From the user\'s view yes — they failed to pay. You can track a separate "internal" SLO excluding upstream declines for engineering accountability, but the user-facing SLO should include anything the user experiences as failure (excluding legitimate business declines like insufficient funds).',
        },
        {
          q: 'How do you choose 99.95% rather than 99.99%?',
          a: 'From historical performance and user/business need: each extra nine costs roughly 10× in effort, and 99.99% (4.3 min/month) is below your dependencies\' availability and your deploy/rollback time.',
        },
      ],
      pitfalls: [
        'SLO of 100% or SLO = SLA.',
        'Measuring availability only from app metrics that miss LB-rejected requests.',
        'Burn-rate thresholds without explaining the budget math.',
      ],
    },
    {
      id: 'observability-iq-07',
      difficulty: 'expert',
      question:
        'Design an observability platform for a company with 800 microservices, 15K pods and 2M requests/second at the edge. Cover collection, storage, cost and governance.',
      whatInterviewerLooksFor: [
        'OpenTelemetry-based collection with collector tiers',
        'Scalable metrics storage (sharded/remote-write) with cardinality governance',
        'Trace sampling strategy with realistic numbers',
        'Log pipeline with tiered storage and cost controls',
        'Multi-tenancy, reliability of the platform itself, and ownership model',
      ],
      modelAnswer: `### Collection
- **OpenTelemetry SDKs** everywhere (auto-instrumentation + a shared internal library that enforces resource attributes: \`service.name\`, \`version\`, \`team\`, \`env\`).
- **Collector as DaemonSet** per node (batching, memory limiter, k8s metadata) → **gateway collectors** (tail sampling, routing, redaction).
- Metrics: Prometheus agents scraping per cluster with \`remote_write\` to central storage; push/OTLP for short-lived jobs.

### Metrics storage
- Horizontally sharded, multi-tenant TSDB (Mimir/Thanos/VictoriaMetrics) on object storage. Budget: 800 services × ~5K active series ≈ 4M baseline, realistically 20–50M with pod and histogram multipliers.
- **Per-team series limits** enforced at ingestion; cardinality dashboards; recording rules pre-aggregate away \`pod\` for long-range dashboards.
- Retention: raw 15 days, 5-min downsampled 90 days, 1-hour 1–2 years.

### Traces
- 2M RPS × ~25 spans × ~1 KB ≈ 50 GB/s at 100% — impossible to store. Head-sample 10% at the edge for baseline and **tail-sample** in the gateway tier: keep all errors and slow traces, ~1% of normal ones. Route spans by trace_id with the load-balancing exporter.
- Generate RED span metrics *before* sampling. Store in Tempo/Jaeger on object storage, 7–14 days.

### Logs
- JSON schema enforced by the shared library; shipping via the node collector/Vector; Loki (labels = service, env, namespace, level) or ClickHouse for analytics.
- Sampling of successful access logs, audit logs on a separate unsampled path, 7-day hot, 90-day cold.

### Platform reliability
- Kafka between collectors and storage to buffer outages; the telemetry path must never block application requests (async exporters, bounded queues, drop on overflow).
- A **meta-monitoring** stack separate from the main one: who alerts when Prometheus is down? A tiny independent watchdog/dead-man's switch.

### Governance and cost
- Chargeback per team (series, GB ingested, spans), golden dashboards and SLO templates generated per service, alert-quality reviews.

### Numbers to anchor
Logs at 2M RPS × 3 lines × 400 B ≈ 2.4 GB/s ≈ 200 TB/day unsampled — sampling success logs to 5% is the difference between feasible and absurd.`,
      followUps: [
        {
          q: 'The metrics backend is down for 20 minutes. What happens to alerting?',
          a: 'Per-cluster Prometheus agents should still evaluate critical alert rules locally (or buffer via WAL and replay on reconnect); a dead-man\'s-switch alert (always firing Watchdog) tells an external service to page if it stops arriving.',
        },
        {
          q: 'Pull or push for this scale?',
          a: 'Pull within each cluster (service discovery, up metric, collector-controlled rate), then push (remote_write/OTLP) to central storage across cluster boundaries; push for batch jobs and serverless.',
        },
        {
          q: 'Build or buy?',
          a: 'At 2M RPS the SaaS bill can reach eight figures a year, so many companies run the OSS stack with a platform team; smaller companies should buy. Either way, standardize on OTel to avoid vendor lock-in.',
        },
      ],
      pitfalls: [
        'One giant Prometheus for everything.',
        'Storing 100% of traces or logs without cost math.',
        'Telemetry exporters that block request threads or crash apps when the backend is down.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'observability-boe-1',
      question:
        'Estimate daily log volume and monthly cost for a platform serving 20K RPS on average, and what sampling success logs would save.',
      assumptions: [
        'Average 20K RPS at the edge; each request produces ~10 log lines across all services it touches',
        'Average JSON log line ≈ 500 bytes',
        'Blended ingest + index + 15-day retention cost ≈ $0.50 per GB',
        '~1% of requests are errors or slow and must be fully logged',
      ],
      steps: [
        { label: 'Lines per second', calc: '20,000 req/s × 10 lines = 200,000 lines/s' },
        { label: 'Bytes per second', calc: '200,000 × 500 B = 100 MB/s' },
        { label: 'Per day', calc: '100 MB/s × 86,400 s ≈ 8.64 TB/day' },
        { label: 'Monthly cost', calc: '8,640 GB × $0.50 ≈ $4,320/day ≈ $130K/month' },
        { label: 'With 2% success sampling', calc: 'errors/slow 1% kept fully + 99% × 2% ≈ 3% of volume → ~260 GB/day ≈ $3.9K/month' },
        { label: 'Hot storage (15 days, ~10× compression)', calc: '8.64 TB × 15 ÷ 10 ≈ 13 TB unsampled vs ~0.4 TB sampled' },
      ],
      answer:
        'About 8.6 TB/day and ~$130K/month unsampled; sampling successful requests at 2% while keeping all errors and slow requests cuts it to ~260 GB/day, roughly a 30× reduction.',
      insight:
        'Log cost scales with traffic × fan-out × verbosity. Per-request success logs should become metrics; logs are for the interesting 1%. This justifies sampling in the logger and pipeline, plus aligning log sampling with trace sampling.',
      followUps: [
        {
          "q": "During an incident the error rate jumps from 1% to 20%. What happens to log volume under your sampling scheme, and is that a problem?",
          "a": "Kept fraction becomes 20% + 80% × 2% ≈ 21.6%, versus about 3% normally, so ingest rises roughly 7× from about 260 GB/day to about 1.9 TB/day equivalent (about $930/day at that rate). Cost is fine for a few hours, but the pipeline is the risk: indexers and the collector queue get 7× load exactly when you need logs, and backpressure can drop the logs you care about. Mitigate by deduplicating repeated errors (keep the first N per error fingerprint per minute and count the rest), adding per-service rate limits in the collector, and provisioning ingest headroom for at least 5×."
        },
        {
          "q": "Traffic grows 10× next year. With sampling in place, what does the bill look like, and which assumption do you attack first?",
          "a": "Sampled volume scales linearly: about 260 GB/day × 10 ≈ 2.6 TB/day, around $39K/month at $0.50/GB, versus about $1.3M/month unsampled. Attack the 10 lines per request next: per-request 'entered handler' and 'called X' lines duplicate what traces already capture. Cutting to 3 meaningful lines per request saves another 70%. Then the $0.50/GB blended price: move cold data to object storage (Loki or ClickHouse on S3 at cents per GB) and keep only 3 days hot. Bytes per line also matter: drop repeated static fields and use short keys."
        }
      ],
    },
    {
      id: 'observability-boe-2',
      question:
        'How many active Prometheus series does one latency histogram produce across the fleet, and what happens if someone adds a customer_id label?',
      assumptions: [
        '40 services, avg 25 routes each, 2 methods per route on average, 5 status classes',
        'Average 20 pods per service, and pod is a label',
        '10 buckets → 10 + Inf + _sum + _count = 13 series per label combination',
        '~2 KB RAM per active series in the Prometheus head block',
        'customer_id would have 50K distinct active values',
      ],
      steps: [
        { label: 'Combinations per service', calc: '25 routes × 2 methods × 5 status × 20 pods = 5,000' },
        { label: 'Fleet combinations', calc: '5,000 × 40 services = 200,000' },
        { label: 'Series', calc: '200,000 × 13 ≈ 2.6M active series' },
        { label: 'Memory', calc: '2.6M × 2 KB ≈ 5.2 GB RAM — fine for a sharded setup' },
        { label: 'Add customer_id (worst case all combos)', calc: '2.6M × 50,000 ≈ 130B series — impossible' },
        { label: 'Realistic sparse case', calc: 'even if each customer hits 20 combos: 50K × 20 × 13 = 13M new series ≈ 26 GB RAM' },
        { label: 'Drop pod label via recording rule', calc: '2.6M ÷ 20 ≈ 130K series for long-range dashboards' },
      ],
      answer:
        'About 2.6M series (~5 GB RAM) today. A customer_id label adds at least tens of millions of series even in the sparse case, enough to OOM Prometheus.',
      insight:
        'Labels multiply. Keep metric labels bounded (route template, status class), aggregate away pod for long-range views, and put customer-level data on traces, logs or exemplars. Enforce sample_limit and per-team series quotas.',
      followUps: [
        {
          "q": "Sales insists on per-customer latency dashboards for the top 20 enterprise accounts. Size a safe metric for it.",
          "a": "Make a separate metric with a bounded `customer` label: the top 20 names plus `other`, so 21 values, and drop the pod label (aggregate in the app or with a recording rule). Per service that is 25 routes × 2 methods × 5 status × 21 customers = 5,250 combinations × 13 series ≈ 68K series, about 140 MB RAM. Keeping the pod label would make it about 1.4M series per service, so dropping it matters. Maintain the allowlist in config, map unknown IDs to `other` in code, and enforce with a relabel rule so a typo can't reintroduce raw IDs."
        },
        {
          "q": "Leadership wants 13 months of retention for capacity planning. Estimate long-term storage for the 2.6M series.",
          "a": "At a 30 s scrape, 2.6M series produce about 86,700 samples/s. Prometheus's TSDB compresses to about 1.5 bytes per sample, so about 11 GB/day and about 4.4 TB for 395 days at full resolution. That is cheap on object storage via Thanos or Mimir. The real cost is querying a year of 2.6M raw series. So downsample (5 m and 1 h resolutions) and, more importantly, store long-range data as recording rules without the pod label (about 130K series) for capacity dashboards, so year-long queries touch about 20× fewer series."
        }
      ],
    },
    {
      id: 'observability-boe-3',
      question:
        'Size tracing storage and the tail-sampling collector tier for 20K traces/second.',
      assumptions: [
        '20K new traces/s (root requests), avg 30 spans per trace, ~1 KB per span (OTLP, pre-compression)',
        'Tail sampling decision_wait = 10 s',
        'Keep 100% errors (0.5% of traces), 100% slow > 500 ms (1%), 2% baseline',
        'Retention 7 days; storage compression ~5×',
      ],
      steps: [
        { label: 'Raw span throughput', calc: '20,000 × 30 × 1 KB = 600 MB/s ≈ 51.8 TB/day' },
        { label: 'Kept fraction', calc: '0.5% + 1% + 2% × ~98.5% ≈ 3.5%' },
        { label: 'Stored per day', calc: '51.8 TB × 3.5% ≈ 1.8 TB/day raw → ÷5 ≈ 360 GB/day compressed' },
        { label: '7-day retention', calc: '360 GB × 7 ≈ 2.5 TB on object storage' },
        { label: 'Collector buffer', calc: '20,000 traces/s × 10 s = 200K traces × 30 KB ≈ 6 GB in memory' },
        { label: 'Collector fleet', calc: '6 GB ×2 headroom ÷ ~2 GB usable per collector ≈ 6 pods, plus N+2 → ~8 tier-2 collectors' },
      ],
      answer:
        'About 52 TB/day of raw spans, of which tail sampling keeps ~3.5% (≈360 GB/day compressed, ~2.5 TB for 7 days). The tier-2 collectors need ~6 GB of buffer in total, spread over ~8 pods with trace-ID routing.',
      insight:
        'Tail sampling moves cost from storage to collector memory and network: every span must still be shipped to the collectors. Size decision_wait carefully (longer waits catch late spans but cost memory), and compute RED metrics before sampling.',
      followUps: [
        {
          "q": "Traffic grows 10× to 200K traces/s. What happens to the tail-sampling tier, and how do you keep it affordable?",
          "a": "The buffer scales linearly: 200K traces/s × 10 s × 30 KB = 60 GB in memory, about 60+ collector pods. Network into tier 2 becomes 6 GB/s, about 48 Gbps, and that has to cross AZs unless routing is zone-aware. Options: shorten `decision_wait` to 5 s if p99 trace duration allows (halving memory); apply a light head sample of low-value traffic (health checks, static assets) at the SDK before export; and compute span-metrics at tier 1 so RED metrics stay complete. Keeping traffic AZ-local avoids paying cross-AZ transfer on every span."
        },
        {
          "q": "During an incident the error rate hits 20% and the 'keep all errors' policy kicks in. What happens to storage and to the collector?",
          "a": "Kept fraction becomes about 20% + 1% + 2% × 79% ≈ 22.6%, versus 3.5% normally, so stored volume jumps about 6.5× to roughly 11.7 TB/day raw, about 2.3 TB/day compressed. The trace backend's ingesters may throttle exactly during the incident. Add a `rate_limiting` or composite policy in the tail sampler: keep all errors up to N traces/s per service (for example 50), then sample errors probabilistically. A thousand identical error traces add nothing over fifty. Collector memory is unaffected, since it buffers everything regardless of the decision."
        }
      ],
    },
  ],
  test: [
    {
      id: 'observability-mcq-01',
      difficulty: 'expert',
      question:
        'A dashboard shows the fleet p99 for the orders service using the query below. The load balancer reports p99 of 1.4 s while this panel shows 380 ms. What is wrong?',
      code: {
        language: 'text',
        code: `avg(
  histogram_quantile(0.99,
    rate(http_server_request_duration_seconds_bucket{service="orders"}[5m]))
)`,
      },
      options: [
        'It computes a p99 per pod/series and then averages them; percentiles are not averageable — sum buckets by le first, then take histogram_quantile',
        'rate() over histogram buckets is invalid; you must use increase() for bucket counters',
        'The 5m window is too long and smooths out spikes; a 30s window would match the load balancer',
        'histogram_quantile needs a summary metric instead of a histogram to be accurate at p99',
      ],
      correct: [0],
      explanation:
        'Without sum by (le), histogram_quantile runs per series (per pod/route), and averaging those p99s hides the pods with bad tails. The correct form is histogram_quantile(0.99, sum by (le) (rate(..._bucket[5m]))). rate() on bucket counters is correct, a 30s window would be noisy and likely below 4× scrape interval, and summaries are the type that cannot be aggregated.',
      followUps: [
        {
          "q": "You fix the query to sum by (le). The fleet p99 now reads 1.1 s, but the load balancer still says 1.4 s. Name two legitimate reasons they differ.",
          "a": "First, they measure different intervals: the LB's latency includes TLS, time queued at the LB, network to the pod, and time waiting in the pod's accept or event-loop queue before the handler's timer starts. App-side histograms only see time inside the handler. Second, bucket interpolation: if the buckets around the tail are 1 s and 2.5 s, `histogram_quantile` linearly interpolates within that wide bucket, so 1.1 s could really be anywhere in it. Add buckets near the region you care about, or use native histograms. Use the LB as the SLI source and the app histogram for drilling down."
        }
      ],
    },
    {
      id: 'observability-mcq-02',
      difficulty: 'hard',
      question:
        'Prometheus scrapes every 30 s. An engineer writes the alert below and it flaps between "no data" and firing. Why?',
      code: {
        language: 'yaml',
        code: `- alert: OrdersErrorsHigh
  expr: sum(rate(http_server_errors_total[30s])) > 5
  for: 2m`,
      },
      options: [
        'The for: 2m clause resets on every scrape, so the alert can never stabilize',
        'A 30s range with a 30s scrape interval often contains fewer than two samples, so rate() returns nothing; use a range of at least 4× the scrape interval, e.g. [2m]',
        'rate() cannot be applied to counters with _total suffix; use irate() instead',
        'sum() drops the labels needed by Alertmanager, causing the alert to be deduplicated away',
      ],
      correct: [1],
      explanation:
        'rate() needs at least two samples inside the range; with a 30s window and 30s scrapes (plus jitter), many evaluations see one sample and produce no result, hence the flapping. The rule of thumb is a range ≥ 4× the scrape interval. irate() has the same two-sample requirement, the _total suffix is conventional for counters, and sum() does not cause dedup problems here.',
      followUps: [
        {
          "q": "Product wants this alert to fire within 30 seconds of a spike, not after 2 minutes. How do you get faster detection without the flapping?",
          "a": "Scrape more often rather than shrinking the range below the sample count: a 10 s scrape for this job allows `rate(...[40s])` with 4 samples. Or put the fast path elsewhere: synthetic probes every 10 s, or an alert on the LB's own metrics, which update every few seconds. Accept the trade-off that a short window is noisy, so pair it with a high threshold (for example a 14.4× burn rate) and require a longer window to agree, as in multi-window burn-rate alerts. Remember the full delay is scrape + evaluation interval + `for` + Alertmanager `group_wait`, often 30–60 s on its own."
        }
      ],
    },
    {
      id: 'observability-mcq-03',
      difficulty: 'medium',
      question:
        'Your services use head sampling at 1% and on-call complains that traces for rare checkout errors (0.05% of requests) are almost never available. Select ALL changes that would reliably retain error traces.',
      options: [
        'Export all spans to an OTel Collector tier running tail_sampling with a status_code ERROR policy, routing spans by trace_id so each trace lands on one collector',
        'Keep head sampling at 1% but have the service that hits the error set the sampled flag to 1 for the rest of the call chain',
        'Raise head sampling to 100% at the SDK, then let the collector tail-sample (keep errors + a small baseline) before storage',
        'Add the error message as a Prometheus label so the trace can be reconstructed from metrics',
      ],
      correct: [0, 2],
      explanation:
        'Tail sampling decides after the trace is complete, so it can keep every error trace, but only if the collector sees all spans (full export) and spans of one trace are routed to the same instance. Flipping the flag mid-chain only records the downstream remainder; the upstream spans were already dropped. Error messages as metric labels create cardinality problems and cannot rebuild a trace.',
      followUps: [
        {
          "q": "You deploy the tail-sampling tier. A week later some error traces are kept but are missing half their spans. What is happening?",
          "a": "Spans from one trace are reaching different tier-2 collectors, or arriving after the decision. Check that tier 1 uses the `loadbalancing` exporter with `routing_key: traceID`; a plain Kubernetes Service balances per connection, so spans scatter. When tier-2 pods scale or restart, the hash ring reshuffles and in-flight traces split, so scale gradually and use a stable DNS resolver for the ring. Late spans (async consumers, long requests) that arrive after `decision_wait` are dropped or start a new decision. Raise `decision_wait` to cover the p99 trace duration, accepting more memory."
        }
      ],
    },
    {
      id: 'observability-mcq-04',
      difficulty: 'expert',
      question:
        'Checkout has a 99.9% availability SLO over 30 days. For the past hour the error ratio has been a steady 1.44%. Which statement is correct?',
      options: [
        'Burn rate is 1.44×; the budget will last about 21 days, so a ticket is enough',
        'Burn rate is 14.4×; about 2% of the monthly budget was consumed in the last hour and the budget would be exhausted in about 2 days',
        'Burn rate is 14.4×; about 14.4% of the monthly budget was consumed in the last hour',
        'The SLO is already breached because 1.44% is above 0.1% for a full hour',
      ],
      correct: [1],
      explanation:
        'Burn rate = 1.44% ÷ 0.1% = 14.4. Budget consumed = 14.4 × (1 h ÷ 720 h) = 2%, and at that pace 720 h ÷ 14.4 = 50 h ≈ 2.1 days to exhaustion. The SLO is evaluated over 30 days, so one bad hour does not breach it by itself; 14.4% consumption confuses the burn rate with the fraction of budget.',
      followUps: [
        {
          "q": "Design the multi-window alert that would have caught this case and still not page on a 5-minute blip.",
          "a": "Use Google SRE's pair: page when burn rate exceeds 14.4 over both 1 h and 5 m, meaning 2% of budget gone in an hour and still happening now. Here 1 h at 14.4× qualifies, and a 5 m window confirms it is ongoing; once it recovers, the 5 m window clears the alert quickly. A 5-minute blip at 20× pushes the 1 h average only to about 20 × 5/60 ≈ 1.7×, so it doesn't page. Add a slower pair (6× over 6 h and 30 m) for a page, and 1× over 3 days for a ticket, to catch slow burns."
        }
      ],
    },
    {
      id: 'observability-mcq-05',
      difficulty: 'hard',
      question:
        'A developer adds a customer_id label (80K active customers) to the existing request-duration histogram to debug one enterprise customer. What happens next in a typical Prometheus setup?',
      options: [
        'Nothing significant; Prometheus compresses labels with dictionary encoding so extra values cost only bytes',
        'Queries become slower but memory stays flat because series are only created when queried',
        'Active series multiply by up to tens of thousands, head-block memory grows by gigabytes, and Prometheus may OOM or hit sample_limit, failing the scrape of that target',
        'Prometheus automatically drops labels with more than 10K values and emits a warning',
      ],
      correct: [2],
      explanation:
        'Every new label combination creates a series in the head block at ingest time (roughly 1–4 KB each), so a histogram × 80K customers explodes memory. If sample_limit is configured the whole scrape fails, losing all metrics from that target. Label compression does not avoid per-series overhead, series exist from ingestion not query, and there is no automatic label dropping.',
      followUps: [
        {
          "q": "The developer still needs to debug that one enterprise customer's latency today. How do you give them that without the cardinality bomb?",
          "a": "Use traces: put `customer.id` as a span attribute and query Tempo or Honeycomb for that customer's slow traces. High cardinality is cheap there. Attach exemplars to the histogram so a latency spike links to a trace ID. If a metric is truly needed, add a bounded label such as `tier` (enterprise, standard) or a `customer` label that only takes the top 20 named accounts, with everyone else as `other`, and drop the pod label for that metric. Guard with `sample_limit` and a relabel rule that drops `customer_id` if it reappears."
        }
      ],
    },
    {
      id: 'observability-mcq-06',
      difficulty: 'hard',
      question:
        'In Tempo, every order shows two separate traces: one ending at the Kafka producer in orders-service, and a new root trace starting in the consumer. Given the consumer code, what is the fix?',
      code: {
        language: 'typescript',
        code: `await consumer.run({
  eachMessage: async ({ message }) => {
    await tracer.startActiveSpan('order-created process', async (span) => {
      await handle(message.value?.toString() ?? '');
      span.end();
    });
  },
});`,
      },
      options: [
        'Switch the sampler to AlwaysOn in the consumer so the trace is not dropped',
        'Convert the message headers to strings, call propagation.extract(ROOT_CONTEXT, carrier) and start the CONSUMER span with that extracted context as parent',
        'Increase the Kafka consumer session timeout so the producer span is still open when the consumer starts',
        'Set the same service.name on both services so Tempo merges the traces',
      ],
      correct: [1],
      explanation:
        'The consumer starts a span in the empty active context, so it becomes a new root. The trace context travels in the Kafka headers (injected by the producer) and must be extracted and used as the parent (or as a span link for batch processing). Sampling does not join traces, span lifetimes are independent of Kafka timeouts, and service.name has nothing to do with trace identity.',
      followUps: [
        {
          "q": "The consumer processes messages in batches of 500. Should each message's producer context be the parent of the batch span?",
          "a": "No: a span has one parent, and the 500 messages come from up to 500 different traces. Create one CONSUMER or `process` span for the batch as a new root, with span links to each message's extracted context, so a trace view can navigate from any producer to the batch. If you process messages individually inside the batch, give each per-message span its own extracted parent so per-order traces stay complete. Limit links (for example the first 128) to bound span size, and record `messaging.batch.message_count` as an attribute."
        }
      ],
    },
    {
      id: 'observability-mcq-07',
      difficulty: 'medium',
      question:
        'You are designing Grafana Loki labels for 300 services. Select ALL that are appropriate as stream labels.',
      options: [
        'service',
        'env (prod, staging)',
        'trace_id',
        'level (error, warn, info)',
        'user_id',
      ],
      correct: [0, 1, 3],
      explanation:
        'Loki indexes only labels, and each unique label set is a separate stream, so labels must be low-cardinality: service, env and level are bounded. trace_id and user_id are unbounded and would create millions of tiny streams and a bloated index; put them in the JSON body (or structured metadata) and filter with | json | trace_id="...".',
      followUps: [
        {
          "q": "Searching all logs for one trace_id across 300 services for the last 24 hours now takes 90 seconds. How do you make it fast without making trace_id a label?",
          "a": "Loki has to scan every chunk in the matching streams, so narrow the scan first: query from the trace itself, using its time window (± a few minutes) and the services the trace touched, so `{service=~\"a|b|c\"}` is selective. Add `trace_id` as structured metadata, which newer Loki versions can filter on without unpacking JSON, and enable bloom filters or a query-accelerator index on it. Scale query parallelism with more queriers and splitting by time. Best of all, link from the trace UI to logs with a pre-filled time range and service set (Grafana's trace-to-logs)."
        }
      ],
    },
    {
      id: 'observability-mcq-08',
      difficulty: 'hard',
      question:
        'Mean latency of the search API is stable at 45 ms, but p99 went from 120 ms to 900 ms. The service runs 24 pods. What is the most efficient next step?',
      options: [
        'Scale the deployment from 24 to 48 pods, since tail latency usually means under-provisioning',
        'Profile CPU on a random pod to find the hot function',
        'Break p99 down by pod (and zone/version) with a latency heatmap; a stable mean with an exploding tail often means a small subset — one pod, node, shard or cache-miss path — is slow',
        'Increase the histogram bucket resolution since p99 is probably an interpolation artifact',
      ],
      correct: [2],
      explanation:
        'A flat mean with a worse tail implies a minority of requests got much slower, which is usually localized (a bad node, a GC-thrashing pod, a hot shard, a subset of cold-cache queries). Splitting by dimensions localizes it quickly. Scaling blindly may not help if one pod or shard is at fault, a random-pod profile may miss the bad pod, and bucket interpolation cannot turn 120 ms into 900 ms.',
      followUps: [
        {
          "q": "The by-pod heatmap shows the slow tail is spread evenly across all 24 pods. What do you split by next?",
          "a": "If every pod has it, the cause is shared or depends on the request. Split by request shape: route, query type, and response size or result-count bucket (the long tail is often 'queries matching many documents'). Split by dependency: span duration per downstream call from traces, for example one Elasticsearch shard or a cold cache path. Check time correlation: GC pauses, cron jobs, and periodic cache expiry synchronised across pods. Open exemplar traces from the slowest buckets and compare their span waterfalls; the slow segment usually shows up immediately."
        }
      ],
    },
    {
      id: 'observability-mcq-09',
      difficulty: 'expert',
      question:
        'The availability SLI is computed from the application\'s own http_server_request_duration_seconds histogram. During a node failure, 30% of pods disappeared for 6 minutes, users saw many 502/503s, but the SLI dashboard showed 99.99%. Why?',
      options: [
        'The histogram buckets were too coarse to capture the failed requests',
        'Pods that are down cannot report requests they never received; the ingress/LB returned the errors, so the SLI must be measured at the load balancer (or with synthetic probes) to see them',
        'Prometheus rate() automatically excludes counter resets caused by pod restarts, hiding the errors',
        'The 5xx responses were classified as 4xx by the gateway, so they were excluded from the valid-events denominator',
      ],
      correct: [1],
      explanation:
        'A server-side SLI only sees requests that reached a healthy handler; failures in front of the app (LB 502/503 while endpoints were missing) are invisible to it. Measure SLIs as close to the user as possible, at the gateway/LB or with probes. Bucket size does not hide status codes, rate() handling resets does not drop errors, and 502/503 were not reclassified.',
      followUps: [
        {
          "q": "You move the SLI to the load balancer. Now a bug makes the app return HTTP 200 with an empty cart for 10% of users. Does the SLI catch it?",
          "a": "No: the LB sees fast 200s, so availability stays perfect while users are clearly hurt. Status codes measure transport success, not correctness. Add a correctness SLI: have the app emit a counter of 'degraded' responses (empty result where data was expected, fallback used), or run synthetic probes that log in as a test user with a known cart and assert on its contents. Track business signals such as add-to-cart rate per minute against the same hour last week, alerting on large drops. Combine them: SLI = good requests (2xx and not degraded) ÷ valid requests."
        }
      ],
    },
    {
      id: 'observability-mcq-10',
      difficulty: 'expert',
      question:
        'Your latency SLO is "99% of requests under 300 ms". The service uses the prom-client default buckets. What problem do you have when computing the SLI with the query below?',
      code: {
        language: 'text',
        code: `# default buckets: 0.005 0.01 0.025 0.05 0.1 0.25 0.5 1 2.5 5 10
sum(rate(http_server_request_duration_seconds_bucket{le="0.3"}[5m]))
  / sum(rate(http_server_request_duration_seconds_count[5m]))`,
      },
      options: [
        'None; Prometheus interpolates missing bucket boundaries automatically in selectors',
        'The query is correct but must use increase() instead of rate() for ratios',
        'There is no le="0.3" series, so the numerator is empty; you can only count below 0.25 or 0.5 exactly — add a 0.3 bucket (or use native histograms) to measure the SLO precisely',
        'The _count series excludes failed requests, so the denominator is too small',
      ],
      correct: [2],
      explanation:
        'Label matchers select existing series only; with default buckets there is no le="0.3", so the query returns no data. Interpolation only happens inside histogram_quantile, and using 0.25 or 0.5 over- or under-counts good requests. rate() vs increase() gives the same ratio, and _count includes every observation regardless of status.',
      followUps: [
        {
          "q": "You add a 0.3 bucket. Six months later the SLO target changes to 250 ms. What happens to history, and how do you avoid this next time?",
          "a": "With default buckets 0.25 exists, so new data works, but every series with the old bucket layout and the new one coexist in the same metric. Mixing layouts across a deploy can produce incorrect `histogram_quantile` results, so annotate the change. Historical SLI at 250 ms has to be computed from the 0.25 bucket, if you had one. Next time, use Prometheus native (exponential) histograms: they have high resolution without fixed boundaries, so any threshold can be computed after the fact within about a 10% error band. Alternatively, keep a dense set of buckets around plausible SLO thresholds."
        }
      ],
    },
    {
      id: 'observability-mcq-11',
      difficulty: 'hard',
      question:
        'You apply the USE method to the Postgres connection pool of a NestJS service. Select ALL metrics that belong to USE for this resource.',
      options: [
        'Utilization: active connections ÷ pool max',
        'Saturation: number of clients waiting to acquire a connection and their wait time',
        'Errors: connection acquire timeouts and connection failures',
        'Duration: HTTP p99 of the endpoints that use the pool',
      ],
      correct: [0, 1, 2],
      explanation:
        'USE describes a resource: how busy it is (active/max), how much work is queued waiting for it (waitingCount, acquire time) and its errors (acquire timeouts, broken connections). HTTP endpoint p99 is a RED signal of the service, not of the pool — useful, but it tells you customers are unhappy, not that the pool is the bottleneck.',
      followUps: [
        {
          "q": "The pool shows utilization 100% and 40 waiters, but Postgres reports only 15 active queries. Where did the other connections go?",
          "a": "They are checked out but idle in the application: a request acquired a connection, started a transaction, then awaited something else (an HTTP call, a slow serializer) before committing. Postgres shows them as `idle in transaction`. Query `pg_stat_activity` grouped by `state` and look at `xact_start` age. The fix is in code: never hold a transaction across network calls, and do external I/O before or after the transaction. Defensively, set `idle_in_transaction_session_timeout` and record a pool-level metric for connection hold time (acquire to release) per route, which points straight at the offending handler."
        }
      ],
    },
    {
      id: 'observability-mcq-12',
      difficulty: 'medium',
      question:
        'On-call receives ~40 pages per week, mostly "CPU > 80% for 5m" and "pod restarted". Users rarely notice anything during these pages. What is the best change?',
      options: [
        'Raise the CPU threshold to 95% and require 15 minutes',
        'Page on SLO burn-rate (symptom) alerts; turn resource alerts into tickets or dashboard signals, and require a runbook for every page',
        'Route all these alerts to a Slack channel so on-call can check them in the morning',
        'Add more replicas so CPU never exceeds 80%',
      ],
      correct: [1],
      explanation:
        'Pages should fire when users are hurt or about to be, which is what burn-rate alerts on SLIs measure. Resource alerts are causes that may or may not matter; they belong in tickets or autoscaling. Tweaking thresholds keeps the same noisy cause-based approach, moving everything to Slack risks missing real issues, and over-provisioning treats the symptom of bad alerting with money.',
      followUps: [
        {
          "q": "After the change, a pod enters a crash loop that users don't notice yet because the other replicas absorb the load. How should that surface, and who finds out?",
          "a": "It should open a ticket or post to the team channel, not page: `kube_pod_container_status_restarts_total` increasing over 30 minutes, or a CrashLoopBackOff state, routed at warning severity with the service owner as assignee. It escalates to a page through the SLO path only if remaining capacity runs out and users start failing. Also add a capacity-headroom alert (healthy replicas below the HPA minimum or below N+1), which predicts user impact before it happens. Review warning-level alerts weekly so they don't rot into ignored noise."
        }
      ],
    },
    {
      id: 'observability-mcq-13',
      difficulty: 'expert',
      question:
        'Service A (ParentBased + 10% ratio root sampler) calls service B with this header. B uses ParentBasedSampler({ root: new TraceIdRatioBasedSampler(1.0) }). What does B do?',
      code: {
        language: 'text',
        code: `traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00`,
      },
      options: [
        'Records the span, because B\'s root sampler is 100%',
        'Starts a brand-new trace with a new trace-id because the parent was not sampled',
        'Does not record B\'s span (non-recording) but still propagates the same trace-id and the unsampled flag to its downstream calls',
        'Rejects the header as invalid because the flags field must be 01',
      ],
      correct: [2],
      explanation:
        'Flags 00 mean the parent was not sampled. ParentBased respects the remote parent\'s decision, so B creates a non-recording span, keeps the trace-id and propagates the unsampled flag downstream; the root sampler only applies when there is no parent. B does not start a new trace, and 00 is a valid flags value.',
      followUps: [
        {
          "q": "B's team says 'we need 100% of our traces regardless of A's decision for an audit'. How do you configure that and what side effects follow?",
          "a": "Use a plain `TraceIdRatioBasedSampler(1.0)` or `AlwaysOn` at B instead of ParentBased, or a custom sampler that records when the parent is unsampled. B then records spans whose parent span was never exported, so the trace view shows B as an orphan subtree under a missing root. B also propagates flag 01 downstream, so its callees start recording too, which raises everyone's volume. Cleaner: keep ParentBased for tracing, and meet the audit requirement with structured audit logs or events, which are complete by design. Sampling is a statistical tool, not an audit trail."
        }
      ],
    },
    {
      id: 'observability-mcq-14',
      difficulty: 'expert',
      question:
        'A Node.js service on a 4-vCPU pod shows 26% CPU utilization, yet p99 latency is 3 s and even /health responds slowly. Which explanation fits best?',
      options: [
        'The database is slow; the health check must be querying it',
        'One Node event-loop thread is pinned near 100% of a single core (26% of 4 vCPUs) by synchronous work, so every request, including /health, waits behind it; confirm with nodejs_eventloop_lag_p99_seconds and a CPU profile',
        'The pod is memory-limited and swapping, which Kubernetes reports as low CPU',
        'The libuv threadpool is exhausted, which only affects fs operations and not HTTP requests',
      ],
      correct: [1],
      explanation:
        'Node runs JavaScript on one thread; ~25% of a 4-core pod is one core fully saturated. A blocking loop (big JSON.stringify, sync crypto, catastrophic regex) delays every callback, which is why a trivial /health is slow too. Kubernetes pods typically do not swap, a DB-backed health check would not explain slowness across all routes this uniformly, and the libuv threadpool also serves dns.lookup, crypto and zlib — but exhaustion there would not slow a pure in-memory /health.',
      followUps: [
        {
          "q": "The CPU profile shows 70% of time in JSON.stringify of a 5 MB product-catalog response. What are your options, and which do you pick?",
          "a": "Avoid the work: cache the serialized string or buffer (regenerate when the catalog changes) and serve it as bytes, often with a CDN in front. That turns per-request CPU into a cheap copy. Next, shrink the payload with pagination or field selection, because 5 MB to clients is a smell anyway. If it must stay dynamic, use a schema-based serializer (`fast-json-stringify`, 2–5× faster) or stream the output. A worker thread only moves the CPU elsewhere: it unblocks the event loop but still burns cores. Verify the fix with event-loop lag p99 and the profile."
        }
      ],
    },
    {
      id: 'observability-mcq-15',
      difficulty: 'expert',
      question:
        'Twenty minutes after rolling out v2.14 to 50% of pods, the checkout error ratio rose from 0.1% to 0.35%. Select ALL actions that are the right next steps.',
      code: {
        language: 'text',
        code: `sum by (version) (rate(http_server_request_duration_seconds_count{service="checkout",status_class="5xx"}[5m]))
  /
sum by (version) (rate(http_server_request_duration_seconds_count{service="checkout"}[5m]))
# result: {version="v2.13"} 0.0011   {version="v2.14"} 0.0059`,
      },
      options: [
        'Roll back v2.14 (or disable its feature flag) now, since the errors are concentrated in the new version',
        'Wait for the full rollout to 100% so the error ratio is measured on more traffic before deciding',
        'Open exemplar/error traces for v2.14 and group its error logs by exception type to find the root cause after mitigation',
        'Raise the SLO target temporarily so the burn-rate alert stops firing during the investigation',
      ],
      correct: [0, 2],
      explanation:
        'The per-version split shows v2.14 at ~0.59% vs ~0.11% for v2.13, a strong signal the release is at fault, so mitigate by rolling back or flipping the flag, then diagnose with traces and grouped logs. Rolling out further would multiply user impact, and changing the SLO to silence alerts defeats the purpose of an error budget.',
      followUps: [
        {
          "q": "Your metrics have no version label, so you couldn't split errors by v2.13 vs v2.14 during the incident. How do you make that split possible next time?",
          "a": "Add the version as a resource attribute (`service.version`) in the OTel SDK and as a target label from the pod's `app.kubernetes.io/version` via relabeling in Prometheus. It's low-cardinality, with only 2–3 values live during a rollout. Traces and logs get it from the same resource. Then automate: Argo Rollouts or Flagger run an analysis query comparing the canary's error ratio and p99 with the stable version every minute, and abort automatically when the canary is worse by more than a margin. This catches problems at 5% traffic instead of 50%."
        }
      ],
    },
  ],
};

export default topic;
