import type { Topic } from '../../types';

const topic: Topic = {
  id: 'deployment-infra',
  phase: 'platform',
  order: 4,
  title: 'Deployment, Kubernetes & Release Strategies',
  subtitle:
    'Images, probes, resources, autoscaling, canaries, feature flags, graceful shutdown and zero-downtime migrations — how code actually reaches production safely',
  estimatedMinutes: 120,
  sources: [
    'Mastering API Architecture — Ch 5 Deploying and Releasing APIs',
    'Kubernetes documentation — Pods, Probes, HPA, Resource Management',
    'Argo Rollouts documentation — Canary & Analysis',
  ],
  tags: ['kubernetes', 'docker', 'canary', 'blue-green', 'hpa', 'probes', 'feature-flags', 'graceful-shutdown', 'migrations', 'rollback'],
  cheatSheet: [
    'Deploy ≠ release: deploy puts bits on servers (reversible infra change); release exposes behaviour to users (flag/traffic change). Decouple them and rollbacks become a config flip.',
    'Liveness = "restart me", readiness = "don\'t send me traffic", startup = "I\'m still booting, hold the other two". Never check dependencies (DB/Redis) in liveness — a DB blip becomes a fleet-wide restart storm.',
    'CPU limit is a CFS quota per 100 ms period: limit 500m = 50 ms of CPU per 100 ms across ALL threads. Throttling shows as p99 latency spikes at low average CPU; watch throttled_periods / periods.',
    'Memory limit breach = kernel OOM kill, exit code 137, reason OOMKilled. Set Node --max-old-space-size to ~70–75% of the container limit so V8 GCs before the cgroup kills you.',
    'HPA: desired = ceil(current × currentMetric / target), 10% tolerance, ~15 s sync, scale-down stabilisation 300 s by default. Real reaction time to a spike = metric lag + sync + pod start + (maybe) node provisioning ≈ 1–5 min.',
    'Rolling (default maxSurge 25% / maxUnavailable 25%) is cheap but mixes versions; blue-green = instant switch + 2× capacity; canary = % of traffic with automated analysis; mirroring = copy traffic, discard responses (beware side effects).',
    'Graceful shutdown: pod marked Terminating → endpoint removal propagates asynchronously while preStop runs → SIGTERM → drain in-flight → exit before terminationGracePeriodSeconds (default 30 s) or SIGKILL.',
    'Run the process as PID 1 with exec-form CMD ["node","dist/main.js"] (not npm start) or use tini, otherwise SIGTERM may never reach Node and every deploy ends in SIGKILL.',
    'Zero-downtime schema change = expand → migrate/backfill → dual-read/write → contract, each step backward compatible with the currently running AND previous app version (so rollback stays safe).',
    'Rollback order of preference: flag off (seconds) → traffic shift back / Argo abort (seconds) → kubectl rollout undo (1–3 min) → forward-fix. Never roll back past a destructive migration.',
  ],
  sections: [
    {
      heading: '1. The mental model: deployment vs release, and the path to production',
      body: `**Intuition:** deploying is moving furniture into a new house; releasing is opening the front door to guests. You can move furniture at 3pm on a Tuesday with nobody watching — you only need to be careful when you open the door.

**Mechanics.** A modern pipeline has three separate, independently reversible changes:

| Change | Mechanism | Blast radius | Undo time |
|---|---|---|---|
| Build | CI produces an immutable image tagged by git SHA + digest | none | n/a |
| Deploy | New ReplicaSet/Rollout pods running the new image, maybe receiving 0% traffic | infra only | 1–3 min |
| Release | Traffic weight or feature flag exposes new behaviour | users | seconds |

Separating deploy from release (the central idea of *Mastering API Architecture* Ch 5) means:
- You can deploy dark code many times a day (trunk-based development).
- Releases are **business decisions** (flag on for 5% of tenants in India), not engineering events.
- Rollback of a bad *behaviour* is a flag flip, not a redeploy.

**Trade-offs.** Flags add code paths (combinatorial testing), flag debt, and a runtime dependency on the flag service. Traffic-based release (canary) needs L7 routing (ingress controller, service mesh, or gateway) and good metrics.

**In interviews say this:** "I treat deploy and release as separate levers. The image rolls out via a canary with automated analysis; risky behaviour sits behind a flag so product can ramp it and I can kill it in seconds without touching the cluster."`,
      diagram: `  git push ──► CI: test, build, scan ──► registry (image@sha256:...)
                                              │
                                  GitOps (Argo CD) syncs manifests
                                              │
                    ┌─────────────────────────▼──────────────────────┐
   DEPLOY           │ Rollout: stable RS (v41)   canary RS (v42)     │
   (infra change)   └───────────┬───────────────────────┬────────────┘
                                │ 95%                   │ 5%
   RELEASE          ingress / mesh traffic split   +  feature flags
   (user change)                │                       │
                         automated analysis (PromQL: errors, p99)
                                │
                     promote ──► 25% ──► 50% ──► 100%   or   abort`,
      keyPoints: [
        'Immutable, SHA-tagged images; never deploy :latest.',
        'Deploy is reversible infra change; release is reversible user-facing change.',
        'Automated analysis, not a human watching Grafana, decides promotion.',
      ],
      source: 'Mastering API Architecture — Ch 5 Deploying and Releasing APIs',
    },
    {
      heading: '2. Docker images that behave in production',
      body: `**Intuition:** an image is a shipping container — it should contain exactly what the app needs to run, nothing it needed to be built, and it should respond when the port authority (Kubernetes) says "leave".

**Best practices that actually matter:**
- **Multi-stage build**: compile TypeScript and install dev deps in a builder stage; copy only \`dist/\` and production \`node_modules\` into a slim runtime. Typical NestJS image drops from ~1.1 GB to ~150–200 MB → faster pulls → faster scale-out (image pull is often 10–40 s of cold-start).
- **Layer ordering for cache**: copy \`package.json\` + lockfile, run \`npm ci\`, *then* copy source. Source changes no longer invalidate the dependency layer.
- **Non-root user** (\`USER node\`), read-only root filesystem where possible, no secrets baked into layers (they persist in history even if deleted later).
- **PID 1 and signals**: \`CMD npm start\` runs npm as PID 1, which historically did not forward SIGTERM reliably; the shell form \`CMD node main.js\` wraps in \`/bin/sh -c\`, which doesn't forward signals either. Use exec form \`CMD ["node", "dist/main.js"]\`. The Linux kernel does not apply default signal actions to PID 1, so if Node has no SIGTERM handler it ignores SIGTERM and gets SIGKILLed after the grace period. Either register a handler (NestJS \`enableShutdownHooks()\`) or run under \`tini\` / \`docker run --init\`.
- **Pin base images by digest** and rebuild regularly for CVE patches; scan in CI (Trivy/Grype).
- **.dockerignore** \`node_modules\`, \`.git\`, \`.env\` — otherwise the build context balloons and secrets leak.
- **Distroless or alpine?** Alpine uses musl libc — some native modules (bcrypt, sharp, grpc) behave differently or need rebuilds; \`node:20-slim\` (Debian) or distroless is the safer default.`,
      code: [
        {
          language: 'text',
          title: 'Dockerfile — multi-stage NestJS image',
          code: `# ---- build stage: has dev deps + TypeScript compiler ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci                              # cached until lockfile changes
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev   # strip dev deps after build

# ---- runtime stage: only what runs ----
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini \\
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node                               # never run as root
EXPOSE 3000
# tini is PID 1: reaps zombies and forwards SIGTERM to node
ENTRYPOINT ["/usr/bin/tini", "--"]
# exec form: node receives signals directly (no /bin/sh wrapper)
CMD ["node", "--max-old-space-size=384", "dist/main.js"]`,
        },
      ],
      keyPoints: [
        'Smaller images = faster pulls = faster autoscaling and rollback.',
        'Exec-form CMD + tini (or a real SIGTERM handler) or every deploy ends in SIGKILL.',
        'Heap flag must match the memory limit you set in the pod spec.',
      ],
    },
    {
      heading: '3. Kubernetes primitives: Deployment, Service, Ingress',
      body: `**Intuition:** a Deployment is the *desired headcount* for a team, a Service is the team's *shared phone number*, and an Ingress is the *building reception* routing outside callers to the right team.

**Mechanics:**
- **Deployment → ReplicaSet → Pods.** Each change to the pod template creates a new ReplicaSet; the Deployment controller scales the new RS up and the old one down according to \`strategy.rollingUpdate\`. Old ReplicaSets are kept (\`revisionHistoryLimit\`, default 10) — that is what \`kubectl rollout undo\` uses.
- **Service** selects pods by label and gets a stable virtual IP. kube-proxy (iptables/IPVS) or an eBPF dataplane (Cilium) load-balances **connections**, not requests. Only pods whose readiness probe passes are in the EndpointSlice.
- **Ingress** (or the newer **Gateway API**) is an L7 router implemented by a controller (NGINX, Envoy-based, AWS ALB). This is where canary weights, TLS termination and path routing live.
- **ConfigMap / Secret** inject config; changing them does NOT restart pods by default — use a checksum annotation on the pod template or a reloader to trigger a rollout.
- **PodDisruptionBudget** limits voluntary evictions (node drains, cluster upgrades) so you never drop below N ready pods.

**Gotcha — L4 balancing of long-lived connections.** HTTP/2 and gRPC multiplex many requests over one TCP connection, so a ClusterIP Service pins a client to one pod. After a scale-out, new pods sit idle while old ones burn. Fix with client-side balancing (gRPC with headless Service + round_robin), a mesh (Envoy balances per request), or \`maxConnectionAge\` on the server.`,
      code: [
        {
          language: 'yaml',
          title: 'Deployment + Service + PDB (core fields)',
          code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 6
  revisionHistoryLimit: 10          # enables 'kubectl rollout undo'
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%                 # up to 2 extra pods during rollout
      maxUnavailable: 0             # never drop below 6 ready pods
  selector:
    matchLabels: { app: orders-api }
  template:
    metadata:
      labels: { app: orders-api }
      annotations:
        checksum/config: '{{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}'  # Helm: roll on config change
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: app
          image: registry.example.com/orders-api@sha256:4f2c...   # digest, not :latest
          ports: [{ containerPort: 3000 }]
---
apiVersion: v1
kind: Service
metadata: { name: orders-api }
spec:
  selector: { app: orders-api }
  ports: [{ port: 80, targetPort: 3000 }]
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: orders-api }
spec:
  minAvailable: 5                   # node drains cannot take more than 1 pod at a time
  selector:
    matchLabels: { app: orders-api }`,
        },
      ],
      keyPoints: [
        'Readiness controls EndpointSlice membership — it is the traffic gate.',
        'Services balance connections, not requests: watch HTTP/2 and gRPC.',
        'ConfigMap changes need a checksum annotation or reloader to roll pods.',
      ],
    },
    {
      heading: '4. Probes: liveness vs readiness vs startup (and how they cause outages)',
      body: `**Intuition:** readiness is the "open/closed" sign on a shop; liveness is the fire alarm that tears the building down and rebuilds it; startup is "renovation in progress — don't judge us yet".

| Probe | On failure | Should check | Must NOT check |
|---|---|---|---|
| **startup** | keeps restarting after threshold; blocks other probes until it passes | app finished booting (migrations loaded, caches warmed) | — |
| **readiness** | removed from Service endpoints (no restart) | can this pod serve *right now*? (event loop healthy, critical dep reachable, not shutting down) | slow optional deps |
| **liveness** | container killed and restarted | process is wedged (deadlock, event loop stuck) — local only | DB, Redis, downstream APIs |

Defaults: \`periodSeconds: 10\`, \`timeoutSeconds: 1\`, \`failureThreshold: 3\` — so a liveness failure restarts a container after ~30 s.

**Classic misconfigurations:**
1. **Liveness checks the DB.** The DB has a 20 s failover → every pod's liveness fails → the whole fleet restarts simultaneously → cold caches + connection storm → the DB, now back, gets hammered → outage extends. A dependency outage became a *self-inflicted* outage.
2. **No startup probe, aggressive liveness.** App takes 60 s to boot (JIT, loading a 200 MB model, running migrations). Liveness with \`initialDelaySeconds: 10\` kills it at ~40 s → **CrashLoopBackOff** forever, even though the app is fine.
3. **timeoutSeconds: 1 on a busy Node process.** Under load the event loop lags 1.5 s → liveness times out → restart under peak traffic → remaining pods get more load → cascade.
4. **Same endpoint for liveness and readiness.** You lose the ability to shed traffic without restarting.
5. **Readiness too strict on a shared dep.** If readiness checks Redis and Redis blips, *all* pods go NotReady → Service has zero endpoints → 503 for everything, even requests that didn't need Redis. Prefer degrading gracefully.

**In interviews say this:** "Liveness should only detect that *this process* is broken beyond self-recovery. Anything that's a shared dependency belongs in readiness at most — or better, in circuit breakers — because liveness failures are correlated across the fleet."`,
      code: [
        {
          language: 'yaml',
          title: 'Probe config for a NestJS service that boots in ~40 s',
          code: `containers:
  - name: app
    startupProbe:                 # allows up to 30 x 5s = 150s to boot
      httpGet: { path: /health/started, port: 3000 }
      periodSeconds: 5
      failureThreshold: 30
    readinessProbe:               # traffic gate; flips fast
      httpGet: { path: /health/ready, port: 3000 }
      periodSeconds: 5
      timeoutSeconds: 2
      failureThreshold: 2         # out of rotation within ~10s
      successThreshold: 1
    livenessProbe:                # restart only if truly wedged
      httpGet: { path: /health/live, port: 3000 }
      periodSeconds: 10
      timeoutSeconds: 5           # tolerate event-loop lag under load
      failureThreshold: 6         # ~60s of consecutive failure before restart`,
        },
        {
          language: 'typescript',
          title: 'health.controller.ts — separate endpoints with different semantics',
          code: `import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { LifecycleState } from './lifecycle.state';
import { DbHealth } from './db.health';

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

@Controller('health')
export class HealthController {
  constructor(private readonly state: LifecycleState, private readonly db: DbHealth) {}

  @Get('started')
  started() {
    if (!this.state.bootCompleted) throw new HttpException('booting', HttpStatus.SERVICE_UNAVAILABLE);
    return { ok: true };
  }

  @Get('live') // local-only: if we can answer at all, the process is alive
  live() {
    return { ok: true };
  }

  @Get('ready')
  async ready() {
    const p99LagMs = loop.percentile(99) / 1e6; // histogram is in nanoseconds
    loop.reset();
    const ok =
      !this.state.shuttingDown &&     // drain: stop receiving new traffic
      p99LagMs < 500 &&               // shed load when the event loop is saturated
      (await this.db.pingWithTimeout(300)); // critical dep, short timeout, cached result
    if (!ok) throw new HttpException('not ready', HttpStatus.SERVICE_UNAVAILABLE);
    return { ok: true, p99LagMs };
  }
}`,
        },
      ],
      keyPoints: [
        'Liveness: local, lenient, rare. Readiness: fast, honest, reversible. Startup: generous.',
        'Dependency checks in liveness convert a dependency blip into a fleet restart.',
        'Tune timeouts for peak load, not idle load.',
      ],
    },
    {
      heading: '5. Resources: requests, limits, CPU throttling and OOMKilled',
      body: `**Intuition:** *requests* are your reserved seat (used for scheduling); *limits* are the ceiling of the room. Exceed the CPU ceiling and you're made to wait; exceed the memory ceiling and you're thrown out.

**CPU (compressible).** Limits are enforced by the Linux CFS bandwidth controller: quota per **100 ms period**. \`limits.cpu: 500m\` = 50 ms of CPU time per 100 ms, summed across **all threads**. A Node process isn't single-threaded at the OS level — GC helper threads, libuv's threadpool (default 4 threads: fs, dns.lookup, crypto, zlib) and the main thread all consume quota. A 40 ms burst of GC + request work on 4 threads can burn 50 ms of quota in 12 ms of wall time → the whole container is frozen for the remaining ~88 ms → p99 latency jumps by ~90 ms while the dashboard shows "average CPU 35%".

Detect it with PromQL:
- throttle ratio: \`rate(container_cpu_cfs_throttled_periods_total[5m]) / rate(container_cpu_cfs_periods_total[5m])\` — above ~5–10% on a latency-sensitive service is a problem.

Fixes: raise or remove the CPU limit (keep requests accurate so scheduling is fair — many teams run latency-critical services with requests but no CPU limit), reduce threadpool/GC concurrency, or scale out.

**Memory (incompressible).** Exceeding \`limits.memory\` triggers the kernel OOM killer: container restarts, \`lastState.terminated.reason: OOMKilled\`, \`exitCode: 137\` (128 + SIGKILL 9). No graceful shutdown, in-flight requests die. For Node, set \`--max-old-space-size\` to ~70–75% of the limit (heap is not the only memory: buffers, native modules, thread stacks, code space). Older Node versions sized the default heap from host memory, not the cgroup — always set it explicitly.

**QoS classes** decide eviction order under node memory pressure: **Guaranteed** (requests = limits for CPU and memory, every container) → evicted last; **Burstable**; **BestEffort** (no requests) → evicted first.

| Symptom | Likely cause | First check |
|---|---|---|
| p99 spikes, avg CPU low | CFS throttling | throttled_periods ratio |
| Restarts, exit 137 | memory limit / leak | \`kubectl describe pod\` lastState, heap trend |
| Pods Pending | requests too big for any node | \`kubectl describe pod\` events: Insufficient cpu |
| Evicted pods | node memory pressure, BestEffort/Burstable | node conditions, QoS class |`,
      code: [
        {
          language: 'yaml',
          title: 'Resources for a latency-sensitive Node API',
          code: `resources:
  requests:
    cpu: "1"          # what the scheduler reserves; also HPA's utilisation baseline
    memory: 512Mi
  limits:
    memory: 512Mi     # memory limit = request: predictable, no overcommit surprises
    # no CPU limit: avoid CFS throttling; requests still guarantee fair share
env:
  - name: NODE_OPTIONS
    value: "--max-old-space-size=384"   # ~75% of 512Mi, leaves room for buffers/native
  - name: UV_THREADPOOL_SIZE
    value: "4"                          # each thread can burn CPU quota`,
        },
        {
          language: 'bash',
          title: 'Diagnosing throttling and OOM kills',
          code: `# Why did it restart? Look for OOMKilled / exit 137
kubectl get pod orders-api-7d9f -o jsonpath='{.status.containerStatuses[0].lastState}'

# Per-pod live usage vs requests
kubectl top pod -l app=orders-api --containers

# Inside the container (cgroup v2): throttling counters
kubectl exec orders-api-7d9f -- cat /sys/fs/cgroup/cpu.stat
# nr_periods 120034  nr_throttled 18211  throttled_usec 912345678   <- 15% throttled

# PromQL: fraction of CFS periods throttled, per pod
# sum by (pod) (rate(container_cpu_cfs_throttled_periods_total{container="app"}[5m]))
#   / sum by (pod) (rate(container_cpu_cfs_periods_total{container="app"}[5m]))`,
        },
      ],
      keyPoints: [
        'CPU limit = quota per 100 ms across all threads; throttling hides behind low averages.',
        'Memory limit breach = SIGKILL, exit 137, no graceful shutdown.',
        'Heap flag ≈ 75% of memory limit for Node.',
      ],
    },
    {
      heading: '6. Horizontal Pod Autoscaler: custom metrics and scaling lag',
      body: `**Intuition:** HPA is a thermostat — it measures, compares to a target, and adjusts headcount. Like a thermostat it reacts *after* the room is already hot.

**Algorithm:** \`desiredReplicas = ceil(currentReplicas × currentMetric / targetMetric)\`, skipped if the ratio is within the **10% tolerance**. The controller syncs every **15 s**. CPU utilisation is measured **relative to requests** — so wrong requests mean wrong scaling (requests 100m on a pod that needs 1 core → "1000% utilisation" → max replicas instantly).

**Custom metrics.** CPU is a poor proxy for I/O-bound Node services (they're waiting on DB, not burning CPU). Better signals:
- requests-per-second per pod or in-flight requests (via Prometheus Adapter → \`custom.metrics.k8s.io\`),
- queue lag / consumer lag for workers (KEDA scales on Kafka lag, SQS depth, even to zero),
- event-loop lag p99.

**Scaling lag — the full chain** for a spike at t=0:

| Stage | Typical time |
|---|---|
| metric scrape + aggregation window (metrics-server ~15 s; Prometheus rate[1m]) | 15–60 s |
| HPA sync loop | 0–15 s |
| scheduling (if node capacity exists) | ~1 s |
| image pull (cached vs not) | 0–40 s |
| app boot + startup/readiness probes | 10–60 s |
| **no free nodes → Cluster Autoscaler / Karpenter provisions a node** | +60–180 s |

So a reactive HPA takes **~1 min in the best case and 3–5 min in the worst**. For a flash sale that's too slow.

**Mitigations:** pre-scale on schedule (KEDA cron scaler or a CronJob raising \`minReplicas\`), keep headroom (target 50–60% not 80%), overprovision with low-priority "balloon" pods that get preempted instantly to free node capacity, aggressive \`scaleUp\` behaviour, and faster boot (smaller image, lazy init). Keep **scale-down slow** (default 300 s stabilisation) to avoid flapping.

**Caveat:** HPA + VPA on the same CPU/memory metric fight each other. And scaling a stateless tier 5× may move the bottleneck to the DB (connection count, see envelope question).`,
      code: [
        {
          language: 'yaml',
          title: 'HPA v2 with RPS-per-pod custom metric and tuned behaviour',
          code: `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: orders-api }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: orders-api }
  minReplicas: 6
  maxReplicas: 60
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 60 }  # % of requests
    - type: Pods                       # exposed by Prometheus Adapter
      pods:
        metric: { name: http_requests_per_second }
        target: { type: AverageValue, averageValue: "300" }    # measured capacity ~500
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0    # react immediately
      policies:
        - { type: Percent, value: 100, periodSeconds: 15 }     # may double every 15s
        - { type: Pods, value: 8, periodSeconds: 15 }
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300  # avoid flapping after a spike
      policies:
        - { type: Percent, value: 10, periodSeconds: 60 }`,
        },
      ],
      keyPoints: [
        'HPA uses the max desired replicas across all listed metrics.',
        'Utilisation is relative to requests — wrong requests, wrong scaling.',
        'Reactive autoscaling is minutes, not seconds: pre-scale for known events.',
      ],
    },
    {
      heading: '7. Release strategies compared: rolling, blue-green, canary, mirroring',
      body: `**Intuition:** rolling = replace the crew one person at a time; blue-green = build a second identical stage and flip the lights; canary = let 5% of the audience in first and watch their faces; mirroring = let a rehearsal run with a recording of the real audience, nobody sees it.

| Strategy | How | Pros | Cons | Use when |
|---|---|---|---|---|
| **Rolling** | Replace pods gradually (\`maxSurge\`, \`maxUnavailable\`) | Built in, ~no extra capacity | Two versions serve concurrently; rollback = another rollout; no traffic control (share ≈ pod ratio) | Low-risk stateless changes |
| **Blue-green** | Full new stack (green), switch Service selector / LB in one step | Instant cut-over and instant rollback; test green before switch | 2× capacity during release; all users hit new version at once; DB must be compatible with both | Big-bang changes needing quick undo, regulated releases |
| **Canary** | Small % of traffic → new version, auto-analysis, step up | Limits blast radius; real prod signal | Needs L7 traffic split + good metrics; low-traffic services need long bake times for statistical signal | Default for important services |
| **Traffic mirroring (shadow)** | Copy live requests to new version, discard its responses | Zero user impact; tests real traffic shape and performance | Side effects (writes, emails, payments) happen twice unless stubbed; doubles downstream load | Rewrites, new DB engines, perf validation |
| **Feature flag / dark launch** | Code deployed everywhere, behaviour gated per user/tenant | Finest-grained, seconds to kill | Code complexity, flag debt | Business feature ramps, kill switches |

**Canary subtleties seniors mention:**
- **Stickiness**: a user bouncing between v1 and v2 can see inconsistent UI/API behaviour — hash on user ID or use header-based routing.
- **Statistical power**: at 5% of 50 RPS you get 2.5 RPS; a 0.5% error-rate regression needs thousands of requests to detect. Bake longer or use a bigger step.
- **Compare canary vs baseline**, not canary vs historical — time-of-day effects confuse absolute thresholds. Kayenta-style comparison or Argo analysis against a baseline ReplicaSet.
- **Pod-ratio canary is coarse**: without a traffic router, 1 canary pod out of 10 ≈ 10% traffic, and HPA scaling changes the ratio.

**Mirroring caution:** make the shadow read-only or point it at sandbox dependencies; propagate a header (e.g. \`x-shadow: true\`) so downstreams can short-circuit writes.`,
      code: [
        {
          language: 'yaml',
          title: 'Istio: 5% canary with mirroring of 100% to a shadow version',
          code: `apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata: { name: orders }
spec:
  hosts: [orders.internal]
  http:
    - match:
        - headers:
            x-canary: { exact: "always" }   # internal testers pinned to canary
      route:
        - destination: { host: orders, subset: v42 }
    - route:
        - destination: { host: orders, subset: v41 }
          weight: 95
        - destination: { host: orders, subset: v42 }
          weight: 5
      mirror: { host: orders, subset: v43-shadow }  # responses discarded
      mirrorPercentage: { value: 100.0 }
      timeout: 2s
      retries: { attempts: 2, perTryTimeout: 800ms, retryOn: "5xx,reset" }`,
        },
      ],
      keyPoints: [
        'Rolling mixes versions — both must be compatible with the schema and with each other.',
        'Blue-green doubles capacity but gives instant rollback.',
        'Canary needs traffic routing and enough volume for statistical signal.',
        'Mirroring duplicates side effects unless shadows are isolated.',
      ],
      source: 'Mastering API Architecture — Ch 5 Deploying and Releasing APIs',
    },
    {
      heading: '8. Progressive delivery with Argo Rollouts and automated analysis',
      body: `**Intuition:** instead of an engineer watching dashboards at 2 am, a robot watches the same queries and pulls the plug the moment they cross a line.

**Mechanics.** Argo Rollouts replaces the Deployment with a \`Rollout\` CRD. The canary strategy defines **steps** (\`setWeight\`, \`pause\`, \`analysis\`) and a **trafficRouting** integration (NGINX, ALB, Istio, SMI, Gateway API) that shifts real traffic weights instead of relying on pod ratios. An \`AnalysisTemplate\` runs Prometheus/Datadog/New Relic queries at an interval; \`successCondition\` and \`failureLimit\` decide pass/fail. A failed analysis **aborts** the rollout: traffic goes back to stable, canary scales down — typically within one analysis interval (~1 min).

**What to analyse:**
- error rate (5xx / total) of the canary service, compared to stable;
- latency p99 from histograms (\`histogram_quantile\`);
- business KPIs for risky changes (checkout success rate, payment auth rate);
- saturation (event-loop lag, DB pool wait).

**Background vs inline analysis.** Background analysis runs continuously across all steps (abort any time); inline analysis gates a specific step.

**Guardrails:**
- Require a minimum request count, otherwise \`0/0\` = NaN → decide explicitly whether NaN passes (it should not for low-traffic canaries; use \`inconclusiveLimit\` or \`len(result) == 0\` checks).
- Use \`scaleDownDelaySeconds\` so the old ReplicaSet stays warm for a fast abort.
- Pair with **Argo CD** (GitOps): the desired image is a git commit, rollback = revert commit, and drift is visible.`,
      code: [
        {
          language: 'yaml',
          title: 'Rollout with stepped canary + Prometheus AnalysisTemplate',
          code: `apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata: { name: orders-api }
spec:
  replicas: 10
  selector: { matchLabels: { app: orders-api } }
  template: { }                      # same pod template as the Deployment
  strategy:
    canary:
      canaryService: orders-canary
      stableService: orders-stable
      trafficRouting:
        nginx: { stableIngress: orders }
      analysis:                      # background: runs from step 1 onwards
        templates: [{ templateName: http-health }]
        startingStep: 1
        args: [{ name: svc, value: orders-canary }]
      steps:
        - setWeight: 5
        - pause: { duration: 5m }
        - setWeight: 25
        - pause: { duration: 10m }
        - setWeight: 50
        - pause: { duration: 10m }   # then 100%
---
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata: { name: http-health }
spec:
  args: [{ name: svc }]
  metrics:
    - name: error-rate
      interval: 1m
      failureLimit: 1                # 2nd failed measurement aborts
      successCondition: result[0] < 0.01
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            sum(rate(http_requests_total{service="{{args.svc}}",code=~"5.."}[2m]))
            / sum(rate(http_requests_total{service="{{args.svc}}"}[2m]))
    - name: p99-latency
      interval: 1m
      failureLimit: 1
      successCondition: result[0] < 0.4   # seconds
      provider:
        prometheus:
          address: http://prometheus.monitoring:9090
          query: |
            histogram_quantile(0.99, sum by (le)
              (rate(http_request_duration_seconds_bucket{service="{{args.svc}}"}[2m])))`,
        },
      ],
      keyPoints: [
        'Traffic routing integration gives exact weights, independent of pod counts.',
        'Automated abort within ~1 analysis interval beats a human noticing.',
        'Handle NaN / low-volume results explicitly.',
      ],
    },
    {
      heading: '9. Feature flags: separating deploy from release in code',
      body: `**Intuition:** a feature flag is a light switch wired in advance — the wiring (code) ships with the deploy, flipping the switch (release) happens whenever you want, for whoever you want.

**Flag types** (and their lifetimes):
- **Release toggles** — hide incomplete features; days to weeks, then delete.
- **Experiment toggles** — A/B tests; bucketed consistently per user.
- **Ops toggles / kill switches** — disable expensive features under load (e.g. turn off recommendations on Black Friday); long-lived.
- **Permission toggles** — premium / beta tenants; long-lived.

**Implementation rules:**
- **Evaluate locally.** SDKs (LaunchDarkly, Unleash, OpenFeature providers, Flagsmith) stream rules into memory; evaluation is a microsecond hash, not a network call per request. If the flag service is down, use the last known config and a **safe default**.
- **Deterministic bucketing.** \`hash(flagKey + userId) mod 10000 < rollout% × 100\` — the same user stays in the same bucket as you ramp 1% → 10% → 50%, and different flags get independent buckets.
- **Evaluate once per request** and pass the decision down, so a mid-request config change doesn't produce a half-old/half-new response.
- **Flag debt**: every flag needs an owner and an expiry; a stale flag is dead code with a loaded gun. (Knight Capital's 2012 $440M loss involved repurposing an old flag that re-activated dead code on one un-updated server.)
- Flags do **not** make schema changes safe — the code on both sides of the flag must work with the current schema.`,
      code: [
        {
          language: 'typescript',
          title: 'flags.service.ts — local evaluation with deterministic percentage rollout',
          code: `import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

interface FlagRule {
  enabled: boolean;          // global kill switch
  rolloutPercent: number;    // 0..100
  allowTenants?: string[];   // explicit targeting
}

@Injectable()
export class FlagsService {
  private readonly log = new Logger(FlagsService.name);
  private rules = new Map<string, FlagRule>();   // refreshed by a streaming/polling client

  update(snapshot: Record<string, FlagRule>) {
    this.rules = new Map(Object.entries(snapshot)); // atomic swap, no partial state
  }

  isEnabled(flag: string, ctx: { userId: string; tenantId: string }, fallback = false): boolean {
    const rule = this.rules.get(flag);
    if (!rule) return fallback;                 // unknown flag or flag service down: safe default
    if (!rule.enabled) return false;            // kill switch wins
    if (rule.allowTenants?.includes(ctx.tenantId)) return true;
    return this.bucket(flag, ctx.userId) < rule.rolloutPercent * 100;
  }

  // Stable bucket in [0, 10000): same user keeps the same bucket while % ramps up;
  // salting with the flag key makes buckets independent across flags.
  private bucket(flag: string, userId: string): number {
    const h = createHash('sha1').update(flag + ':' + userId).digest();
    return h.readUInt32BE(0) % 10000;
  }
}`,
        },
      ],
      keyPoints: [
        'Local, in-memory evaluation with safe defaults — flag service outage must not be your outage.',
        'Deterministic hashing keeps users in stable cohorts while ramping.',
        'Every flag has an owner and an expiry date.',
      ],
      source: 'Mastering API Architecture — Ch 5 Deploying and Releasing APIs',
    },
    {
      heading: '10. Graceful shutdown: SIGTERM, preStop and connection draining',
      body: `**Intuition:** closing a restaurant properly means taking the sign off the street first, letting seated guests finish, then locking the door — not switching off the lights mid-meal.

**What Kubernetes actually does when a pod is deleted** (rollout, scale-down, node drain):
1. Pod gets \`deletionTimestamp\` → state **Terminating**. The grace period timer (\`terminationGracePeriodSeconds\`, default 30 s) starts.
2. **In parallel**: the EndpointSlice controller removes the pod from Service endpoints, and kubelet runs the **preStop** hook. Endpoint removal must then propagate to every kube-proxy, ingress controller and mesh sidecar — this takes **1–10 s** and is *not* coordinated with the kubelet.
3. After preStop finishes, kubelet sends **SIGTERM** to PID 1.
4. If the process is still running when the grace period expires → **SIGKILL**.

**The race:** without a preStop delay, Node receives SIGTERM, closes its server immediately, but the ingress still sends it requests for a few seconds → connection refused / **502s on every deploy**. Fix: \`preStop\` sleep of 5–15 s (native \`lifecycle.preStop.sleep\` in recent Kubernetes versions, or \`exec: sleep 10\` if the image has a shell), *then* drain.

**Draining in Node/NestJS:**
- \`app.enableShutdownHooks()\` registers SIGTERM/SIGINT listeners and runs lifecycle hooks: \`onModuleDestroy\` → \`beforeApplicationShutdown\` → HTTP server closed → \`onApplicationShutdown\`.
- Wait for in-flight requests (counter middleware) with a deadline shorter than the grace period.
- Close resources (DB pools, Kafka consumers — commit offsets!, Redis) in \`onApplicationShutdown\`, *after* the server stops, not in \`onModuleDestroy\`.
- **Keep-alive**: idle keep-alive sockets hold \`server.close()\` open. Newer Node versions close idle connections on \`close()\`; also set \`Connection: close\` on responses during drain. Set \`keepAliveTimeout\` above the load balancer's idle timeout (ALB default 60 s → 65 s) to avoid the other classic 502 where the server closes a socket the LB is about to reuse.

**Budget:** preStop (10 s) + drain (≤ 20 s) + cleanup (≤ 5 s) must fit in \`terminationGracePeriodSeconds\` (set 45 s). Long-running work (WebSockets, 5-minute report jobs) needs either a longer grace period or checkpoint-and-resume semantics.`,
      diagram: `t=0   pod Terminating ──┬── endpoints removed ── propagates to LB (1-10s)
                        └── preStop: sleep 10 (still serving stragglers)
t=10  SIGTERM ──► stop accepting, readiness=503, drain in-flight (<=20s)
t≤30  close DB pool, commit Kafka offsets, flush logs ──► exit(0)
t=45  (grace period) SIGKILL if still alive  ✗ in-flight requests lost`,
      code: [
        {
          language: 'typescript',
          title: 'main.ts + lifecycle — NestJS graceful drain',
          code: `import { NestFactory } from '@nestjs/core';
import { Injectable, BeforeApplicationShutdown, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

@Injectable()
export class LifecycleState implements BeforeApplicationShutdown {
  bootCompleted = false;
  shuttingDown = false;
  inFlight = 0;

  async beforeApplicationShutdown(signal?: string) {
    this.shuttingDown = true;                       // readiness now returns 503
    const deadline = Date.now() + 20_000;           // must fit in the grace period
    while (this.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    console.log('drained', { signal, remaining: this.inFlight });
  }
}

@Injectable()
export class InFlightMiddleware implements NestMiddleware {
  constructor(private readonly state: LifecycleState) {}
  use(_req: Request, res: Response, next: NextFunction) {
    this.state.inFlight++;
    if (this.state.shuttingDown) res.setHeader('Connection', 'close'); // don't reuse socket
    res.on('close', () => this.state.inFlight--);  // fires on finish AND client abort
    next();
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);  // lifecycle hooks run on signal
  const server = app.getHttpServer();
  server.keepAliveTimeout = 65_000;                // > ALB idle timeout (60s)
  server.headersTimeout = 66_000;                  // must exceed keepAliveTimeout
  await app.listen(3000);
  app.get(LifecycleState).bootCompleted = true;
}
bootstrap();`,
        },
        {
          language: 'yaml',
          title: 'Pod spec: preStop delay and grace budget',
          code: `spec:
  terminationGracePeriodSeconds: 45     # preStop 10 + drain 20 + cleanup + margin
  containers:
    - name: app
      lifecycle:
        preStop:
          sleep: { seconds: 10 }        # native sleep action (K8s 1.30+ default-on)
          # older clusters: exec: { command: ["sleep", "10"] }  (needs sleep binary)`,
        },
      ],
      keyPoints: [
        'Endpoint removal and SIGTERM race; preStop sleep closes the gap.',
        'Drain in-flight with a deadline < grace period; close pools after the server.',
        'keepAliveTimeout > LB idle timeout prevents intermittent 502s.',
      ],
    },
    {
      heading: '11. Zero-downtime database migrations: expand / contract',
      body: `**Intuition:** you can't swap a bridge while cars are on it — build the new lane beside it, move traffic over, then demolish the old lane.

During any rolling or canary deploy, **old and new app versions run simultaneously against the same database**, and after a rollback the old version runs against the *new* schema. So every migration step must be compatible with **N-1 and N**.

**Renaming \`users.name\` → \`users.full_name\` safely:**
1. **Expand** (migration only): add nullable \`full_name\`. App v1 unaffected.
2. **Dual-write** (deploy v2): write both columns, read \`name\`. Rollback to v1 is safe.
3. **Backfill** in batches (\`UPDATE ... WHERE id BETWEEN ...\` with small batches, sleeps, and replication-lag checks) — never a single multi-million-row UPDATE holding locks and generating massive WAL.
4. **Switch reads** (deploy v3): read \`full_name\`, still write both. Verify.
5. **Stop writing old column** (deploy v4).
6. **Contract** (weeks later, after v3 can no longer be rolled back to): drop \`name\`.

**Postgres lock traps:**
- Any \`ALTER TABLE\` needs an ACCESS EXCLUSIVE lock briefly. If a long-running query holds a conflicting lock, the ALTER **waits in the lock queue and blocks every query behind it** → instant outage. Always \`SET lock_timeout = '3s'\` and retry.
- \`ADD COLUMN ... DEFAULT <constant>\` is metadata-only since PG 11; volatile defaults (\`now()\` is stable — fine; \`gen_random_uuid()\` is volatile) rewrite the table.
- \`CREATE INDEX CONCURRENTLY\` avoids blocking writes but can't run in a transaction and can leave an INVALID index on failure — check and drop/retry.
- Adding NOT NULL: add \`CHECK (col IS NOT NULL) NOT VALID\`, then \`VALIDATE CONSTRAINT\` (weaker lock, allows writes), then \`SET NOT NULL\` (PG 12+ skips the scan when a valid check exists).
- Foreign keys: \`ADD CONSTRAINT ... NOT VALID\` then \`VALIDATE\`.

**Run migrations as a separate step** (a Job / pre-sync hook) rather than on app boot: 20 pods racing to migrate on startup is a lock-contention and CrashLoop generator.`,
      code: [
        {
          language: 'sql',
          title: 'Expand/contract migration steps for Postgres',
          code: `-- Step 1: EXPAND (safe with app v1 running)
SET lock_timeout = '3s';                 -- fail fast instead of queueing behind long txns
ALTER TABLE users ADD COLUMN full_name text;   -- nullable, metadata-only

-- Step 3: BACKFILL in small batches (run from a job, loop until 0 rows)
UPDATE users SET full_name = name
WHERE id IN (
  SELECT id FROM users
  WHERE full_name IS NULL
  ORDER BY id
  LIMIT 5000
  FOR UPDATE SKIP LOCKED                 -- don't fight with live traffic
);

-- Step 4b: enforce NOT NULL without a long exclusive lock
ALTER TABLE users ADD CONSTRAINT users_full_name_nn
  CHECK (full_name IS NOT NULL) NOT VALID;     -- instant
ALTER TABLE users VALIDATE CONSTRAINT users_full_name_nn;  -- scans, allows writes
ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;     -- PG12+: uses the check, no scan
ALTER TABLE users DROP CONSTRAINT users_full_name_nn;

-- Index without blocking writes (must be outside a transaction)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_full_name ON users (full_name);

-- Step 6: CONTRACT (only after no deployable version reads/writes "name")
ALTER TABLE users DROP COLUMN name;`,
        },
      ],
      keyPoints: [
        'Every step must work with the previous and next app version.',
        'lock_timeout on every DDL; lock queues cause outages, not the DDL itself.',
        'Contract only when rollback to a version needing the old column is impossible.',
      ],
    },
    {
      heading: '12. Scenario playbook: spikes, bad deploys, rollbacks, hot pods, CrashLoopBackOff',
      body: `**Traffic spike (5–10× in minutes).** Check HPA status (\`kubectl get hpa\` — at maxReplicas? metric unknown?), pending pods (node capacity), and the *downstream* (DB connections, rate limits). Fix now: raise \`maxReplicas\`/\`minReplicas\` manually, enable kill-switch flags for expensive features, shed load at the edge. Fix permanently: pre-scaling for known events, headroom, balloon pods, load-shedding by priority.

**Deploy increases latency/errors.** Correlate the regression start with the rollout (deploy annotations on dashboards). If canary: abort. If rolling: \`kubectl rollout undo\` (or revert the git commit in GitOps — otherwise Argo CD will re-sync the bad version). Compare new vs old pods by \`version\` label: if only new pods are bad, it's code/config; if all pods regressed, it's load shift, cold caches, or a migration.

**Rollback realities.** Rollback is safe only if: (a) the schema is backward compatible, (b) no new-format data was written that the old version can't read (new enum values, new message schemas on Kafka), (c) config/secrets were versioned with the image. Otherwise forward-fix, or flip the flag.

**One pod eats CPU while siblings idle.** Candidates: long-lived HTTP/2/gRPC connections pinned to it (L4 balancing), a hot key / hot tenant routed by consistent hashing, a stuck retry loop or runaway regex, GC thrash near its memory limit, or a noisy neighbour on the node. Check per-pod RPS vs CPU: high CPU + normal RPS → work per request (profile it: \`--cpu-prof\`, clinic flame); high RPS → balancing problem.

**CrashLoopBackOff.** Kubelet restarts with exponential backoff 10 s, 20 s, 40 s … capped at 5 min (reset after 10 min of healthy running). Diagnose in this order: \`kubectl describe pod\` (events, last state, exit code), \`kubectl logs --previous\`, then reason by exit code:

| Exit code | Meaning | Typical cause |
|---|---|---|
| 1 | app error | missing env/secret, bad config, failed DB connect on boot |
| 137 | SIGKILL | OOMKilled or liveness kill (check reason) |
| 143 | SIGTERM | killed by liveness/probe failure and exited on SIGTERM |
| 127 / 126 | command not found / not executable | wrong CMD/ENTRYPOINT, missing binary in distroless |
| 0 (restarting) | process exits cleanly | app isn't a long-running server (script finished) |`,
      code: [
        {
          language: 'bash',
          title: 'Incident commands: rollout status, undo, CrashLoop triage',
          code: `# Is a rollout in progress / stuck? (progressDeadlineSeconds default 600s)
kubectl rollout status deploy/orders-api --timeout=60s
kubectl rollout history deploy/orders-api

# Roll back to previous ReplicaSet (or --to-revision=N)
kubectl rollout undo deploy/orders-api
# Argo Rollouts: abort canary, send 100% to stable immediately
kubectl argo rollouts abort orders-api

# Compare old vs new pods side by side
kubectl get pods -l app=orders-api -L pod-template-hash,version
kubectl top pod -l app=orders-api --sort-by=cpu

# CrashLoopBackOff triage
kubectl describe pod orders-api-6c9d-x2k   # Events + Last State + Exit Code
kubectl logs orders-api-6c9d-x2k --previous # logs of the crashed container
kubectl get events --sort-by=.lastTimestamp | tail -20

# Debug a distroless container without a shell
kubectl debug -it orders-api-6c9d-x2k --image=busybox --target=app

# Emergency capacity during a spike
kubectl patch hpa orders-api -p '{"spec":{"minReplicas":30,"maxReplicas":120}}'`,
        },
      ],
      keyPoints: [
        'New-pods-only regression → code/config; all pods → load, dependency or migration.',
        'In GitOps, roll back in git or the controller re-applies the bad version.',
        'Exit codes (1, 137, 143, 127) point to the cause before you read a single log line.',
      ],
    },
  ],
  codeChallenges: [
    {
      id: 'deployment-infra-cc-1',
      title: 'Fix the pod spec that restarts itself into an outage',
      context:
        'The payments-api Deployment below has caused three incidents this quarter: a fleet-wide restart during a 20-second Postgres failover, CrashLoopBackOff after a release that added a 45-second cache warm-up, and random OOMKilled restarts under load. p99 also spikes to ~250 ms every few seconds although average CPU is 30%. The service is a NestJS app that boots in 30–60 s.',
      task: 'Rewrite the container spec so that dependency blips never restart pods, slow boots are tolerated, memory kills stop, latency spikes from CPU limits disappear, and deploys drain cleanly. Keep it a realistic production manifest.',
      starter: {
        language: 'yaml',
        title: 'payments-api (starter)',
        code: `apiVersion: apps/v1
kind: Deployment
metadata: { name: payments-api }
spec:
  replicas: 8
  strategy:
    rollingUpdate: { maxSurge: 50%, maxUnavailable: 50% }
  selector: { matchLabels: { app: payments-api } }
  template:
    metadata: { labels: { app: payments-api } }
    spec:
      containers:
        - name: app
          image: registry.example.com/payments-api:latest
          command: ["npm", "start"]
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits:   { cpu: 500m, memory: 512Mi }
          livenessProbe:
            httpGet: { path: /health, port: 3000 }   # checks Postgres + Redis
            initialDelaySeconds: 10
            timeoutSeconds: 1
          readinessProbe:
            httpGet: { path: /health, port: 3000 }
            initialDelaySeconds: 10`,
      },
      hints: [
        'What does the liveness probe do when Postgres fails over for 20 s — on every pod at once?',
        'How long can the app take to boot before liveness kills it, and which probe exists to protect slow starts?',
        'Who is PID 1 with `npm start`, what is V8\'s heap ceiling relative to 512Mi, and what does a 500m CFS quota mean for a process with GC and libuv threads?',
      ],
      solution: {
        language: 'yaml',
        title: 'payments-api (production-grade)',
        code: `apiVersion: apps/v1
kind: Deployment
metadata: { name: payments-api }
spec:
  replicas: 8
  revisionHistoryLimit: 10
  strategy:
    rollingUpdate: { maxSurge: 25%, maxUnavailable: 0 }   # never lose capacity
  selector: { matchLabels: { app: payments-api } }
  template:
    metadata: { labels: { app: payments-api, version: "v42" } }
    spec:
      terminationGracePeriodSeconds: 45
      topologySpreadConstraints:
        - { maxSkew: 1, topologyKey: topology.kubernetes.io/zone,
            whenUnsatisfiable: ScheduleAnyway,
            labelSelector: { matchLabels: { app: payments-api } } }
      containers:
        - name: app
          image: registry.example.com/payments-api@sha256:9b1e...  # immutable
          # exec form in the image: ENTRYPOINT tini, CMD ["node","dist/main.js"]
          env:
            - { name: NODE_OPTIONS, value: "--max-old-space-size=768" }  # ~75% of 1Gi
          resources:
            requests: { cpu: "1", memory: 1Gi }   # measured, not guessed
            limits:   { memory: 1Gi }             # no CPU limit -> no CFS throttling
          startupProbe:                            # up to 150s to boot
            httpGet: { path: /health/started, port: 3000 }
            periodSeconds: 5
            failureThreshold: 30
          readinessProbe:                          # traffic gate, fast
            httpGet: { path: /health/ready, port: 3000 }
            periodSeconds: 5
            timeoutSeconds: 2
            failureThreshold: 2
          livenessProbe:                           # local only, lenient
            httpGet: { path: /health/live, port: 3000 }
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 6
          lifecycle:
            preStop:
              sleep: { seconds: 10 }               # let endpoint removal propagate
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata: { name: payments-api }
spec:
  maxUnavailable: 1
  selector: { matchLabels: { app: payments-api } }`,
      },
      explanation: `**Fixes, one per incident:**
- **Fleet restart on DB failover**: liveness no longer checks Postgres/Redis — \`/health/live\` is process-local. Dependency health influences readiness at most (with a short timeout), so a failover sheds traffic instead of restarting 8 pods simultaneously with cold caches and a connection storm.
- **CrashLoopBackOff on slow boot**: a \`startupProbe\` allows 150 s; liveness/readiness don't run until it passes. Previously liveness killed the pod at ~40 s (10 s delay + 3 × 10 s).
- **OOMKilled**: memory request = limit (predictable), and V8's heap is capped at ~75% of the limit so GC works before the cgroup OOM killer strikes. Requests were raised to measured values; 100m CPU request also made HPA utilisation and scheduling meaningless.
- **p99 spikes at 30% CPU**: removed the 500m CPU limit — CFS gave the process 50 ms per 100 ms across all threads, so GC bursts froze it. Requests still guarantee fair share.
- **Clean deploys**: \`maxUnavailable: 0\` (50/50 could drop to 4 pods mid-deploy), \`preStop\` sleep + 45 s grace period for draining, exec-form CMD with tini instead of \`npm start\` so SIGTERM actually reaches Node, and separate \`/health/*\` endpoints so readiness can drop without liveness restarting.
- **Hygiene**: image pinned by digest (\`:latest\` makes rollback meaningless), zone spread + PDB so a node drain or AZ loss can't take out most replicas.`,
      followUps: [
        {
          "q": "Removing the CPU limit worries the platform team about noisy neighbours. How do you justify it, and what guardrails keep it safe?",
          "a": "CPU is compressible: without a limit, a pod can use idle cycles, but under contention the kernel shares CPU in proportion to requests (CFS shares), so neighbours still get what they reserved. The risk is only that you plan with burst capacity that disappears when the node is busy. Guardrails: accurate requests (VPA recommendations), a namespace ResourceQuota on total requests, LimitRange defaults, alerts on node CPU saturation, and keeping memory limits, because memory is incompressible."
        },
        {
          "q": "How would you validate this manifest in CI so the same mistakes can't come back?",
          "a": "Use policy-as-code at PR time: kube-linter, Conftest/OPA or Kyverno rules that reject `:latest` tags, a missing startupProbe on services with known slow boots, liveness and readiness pointing at the same path, `maxUnavailable` > 0 on critical services, a CPU limit below 1 core on Node services, a missing PDB or topology spread, and `command: [npm, start]`. Run `kubeconform` for schema validity. Then run a staging deploy under load with a scripted DB failover, and assert zero restarts and zero 5xx."
        }
      ],
    },
    {
      id: 'deployment-infra-cc-2',
      title: 'Make this NestJS bootstrap survive deploys without 502s',
      context:
        'Every rollout of the orders service produces a burst of 502/connection-reset errors at the ingress for ~5 seconds per pod, and occasionally Kafka messages are processed twice after a deploy. Behind an AWS ALB (idle timeout 60 s). terminationGracePeriodSeconds is 30.',
      task: 'Rewrite the bootstrap and shutdown logic so that pods stop receiving traffic before they stop serving, in-flight HTTP requests complete, the Kafka consumer commits its progress, and resources close in the right order — all inside the grace period.',
      starter: {
        language: 'typescript',
        title: 'main.ts (starter)',
        code: `import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { KafkaConsumer } from './kafka.consumer';
import { DataSource } from 'typeorm';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);

  const consumer = app.get(KafkaConsumer);
  await consumer.start(); // autoCommit: every 5s

  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, bye');
    await app.get(DataSource).destroy();   // close DB first
    process.exit(0);                        // immediate exit
  });
}
bootstrap();`,
      },
      hints: [
        'When SIGTERM arrives, is the pod already out of every load balancer\'s rotation? What covers the gap?',
        'What happens to requests currently running when process.exit(0) is called — and to requests that still need the DB after it was destroyed?',
        'Node\'s default keepAliveTimeout is 5 s while the ALB reuses idle connections for up to 60 s. Who closes the socket first?',
      ],
      solution: {
        language: 'typescript',
        title: 'main.ts + shutdown coordinator (solution)',
        code: `import { NestFactory } from '@nestjs/core';
import { Injectable, BeforeApplicationShutdown, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { KafkaConsumer } from './kafka.consumer';
import { LifecycleState } from './lifecycle.state'; // shuttingDown flag + inFlight counter

@Injectable()
export class ShutdownCoordinator implements BeforeApplicationShutdown, OnApplicationShutdown {
  constructor(
    private readonly state: LifecycleState,
    private readonly consumer: KafkaConsumer,
    private readonly db: DataSource,
  ) {}

  // Runs BEFORE the HTTP server closes. preStop (sleep 10) already ran, so the
  // LB has stopped routing new requests here; we only finish what's in flight.
  async beforeApplicationShutdown() {
    this.state.shuttingDown = true;                 // readiness -> 503
    await this.consumer.stop();                     // stop fetching, finish batch, commit offsets
    const deadline = Date.now() + 12_000;
    while (this.state.inFlight > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // Runs AFTER the HTTP server has closed: nothing can use the DB any more.
  async onApplicationShutdown(signal?: string) {
    await this.db.destroy();
    console.log('shutdown complete', { signal, leftover: this.state.inFlight });
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);   // Nest handles the signal, no process.exit
  const server = app.getHttpServer();
  server.keepAliveTimeout = 65_000;                 // > ALB idle timeout (60s)
  server.headersTimeout = 66_000;
  await app.listen(3000);
  await app.get(KafkaConsumer).start({ autoCommit: false }); // commit after processing
  app.get(LifecycleState).bootCompleted = true;
}
bootstrap();

// Pod spec: lifecycle.preStop.sleep.seconds: 10, terminationGracePeriodSeconds: 30
// Budget: 10s preStop + <=12s drain + ~3s cleanup = 25s < 30s`,
      },
      explanation: `**What was wrong and how it's fixed:**
- **No preStop delay** → SIGTERM arrived while the ALB/ingress still routed to the pod; the fix is a 10 s \`preStop\` sleep so endpoint removal propagates before we stop serving.
- **\`process.exit(0)\` immediately** killed in-flight requests (the 502/resets). Now \`enableShutdownHooks\` runs the Nest lifecycle and we wait for the in-flight counter with a deadline inside the grace budget.
- **DB closed first** meant requests still running failed with "connection terminated". Resource teardown moved to \`onApplicationShutdown\`, which runs after the HTTP server closes.
- **Duplicate Kafka processing**: with autoCommit every 5 s, messages processed since the last commit were re-delivered to another consumer after the rebalance. The consumer now commits after processing and is stopped (commit + leave group) during shutdown. Handlers should still be idempotent — at-least-once remains the contract.
- **keepAliveTimeout 5 s < ALB 60 s**: Node closed idle sockets the ALB was about to reuse → intermittent 502s even outside deploys. Raised to 65 s, with headersTimeout above it.
- **Budget** is explicit: 10 + 12 + ~3 s fits in the 30 s grace period, so SIGKILL never fires.`,
      followUps: [
        {
          "q": "A request takes 40 s (a large report). What happens to it with your shutdown budget, and how would you handle such requests?",
          "a": "The 12 s drain deadline passes, the server closes and the request is cut, then SIGKILL fires at 30 s anyway. Long synchronous requests don't fit graceful shutdown. Move them to async jobs: the API enqueues the report and returns 202 with a job id, a worker processes it with checkpoints, and the client polls or gets a webhook. If some must stay synchronous, give that deployment a longer `terminationGracePeriodSeconds` (e.g. 120 s) and a matching drain deadline, accepting slower rollouts for it."
        },
        {
          "q": "How would you write an automated test that proves shutdown is clean: no dropped requests and no duplicate Kafka processing?",
          "a": "Run an integration test with Testcontainers (Kafka, Postgres) running the app in a child process. Send continuous HTTP requests (some deliberately slow, ~2 s) and produce N numbered Kafka messages. Mid-way, send SIGTERM. Assert that every HTTP request that was accepted completed with 200, and new connections were refused only after the drain began. Start a second instance with the same group id, then assert each message id was processed exactly once in the DB, with no gaps and no duplicates, and that the process exited with code 0 before the grace deadline."
        }
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'deployment-infra-iq-01',
      difficulty: 'hard',
      question:
        'Ten minutes after a rolling deploy of the checkout service, p99 went from 120 ms to 1.8 s and the 5xx rate is 2%. Walk me through the next 15 minutes.',
      context: 'Rolling update, 24 pods, deploy finished 10 minutes ago. The release also included a migration that added an index.',
      whatInterviewerLooksFor: [
        'Mitigate first (rollback/flag) before root-causing',
        'Distinguishes new-pod-only vs fleet-wide regression using labels',
        'Considers that the migration may make rollback insufficient',
        'Knows GitOps rollback semantics and verification of recovery',
        'Follows up with prevention: canary + automated analysis',
      ],
      modelAnswer: `### 1. Stabilise (minutes 0–5)
- Declare an incident, one person drives. Check the deploy annotation lines up with the regression — correlation is strong but confirm.
- **Cheapest reversible action first**: if the change is behind a flag, flip it off (seconds). Otherwise roll back: in GitOps revert the commit (or Argo CD will re-sync the bad image); \`kubectl rollout undo\` otherwise. Rollback takes ~1–3 min for 24 pods with maxSurge 25%.

### 2. Is it the code or the environment? (in parallel)
- Split metrics by \`version\` / \`pod-template-hash\`. After a completed rollout everything is new, so compare with the last good window: which **endpoints** regressed, and is the time going into our process (CPU, event-loop lag, GC) or into dependencies (DB query time, pool wait)?
- **The migration is a prime suspect**: a \`CREATE INDEX\` without \`CONCURRENTLY\` blocks writes; a DDL that queued behind a long transaction blocks every query behind it; a new index can change query plans. Check \`pg_stat_activity\` for lock waits and \`pg_locks\`.
- Other usual suspects: cold caches (new cache-key format → 0% hit rate), N+1 introduced by a new resolver, reduced pool size in new config, CPU limit throttling from new resource settings.

### 3. Decide
- If rollback fixes it → code/config. Keep the old version, root-cause offline.
- If rollback **doesn't** fix it → the migration/data or a dependency. Rolling back the app doesn't undo schema changes; you may need to cancel the blocking query (\`pg_cancel_backend\`) or drop the invalid index.

### 4. Afterwards
- Blameless postmortem. Move checkout to canary with Argo Rollouts analysis on error rate and p99 (abort within ~1 min at 5% traffic instead of 100% for 10 min). Run migrations as a separate, reviewed step with \`lock_timeout\`, and before the app deploy.`,
      followUps: [
        {
          q: 'The rollback finished but p99 is still 1.5 s. What now?',
          a: 'The cause is not in the image: look at the database (lock waits, new plan from the index, bloat, replica lag), the cache (hit rate dropped because the new version wrote a different key format and evicted hot keys), or a dependency. Old code on a changed environment is still broken; check `pg_stat_activity` wait events first.',
        },
        {
          q: 'How would you have caught this before 100% of users were affected?',
          a: 'Canary at 5% with background analysis comparing canary vs stable error rate and p99, and a minimum-request-count guard; abort automatically. Also a synthetic check hitting checkout during rollout, and running the migration separately with a dry run on a production-sized copy.',
        },
        {
          q: 'When is forward-fix better than rollback?',
          a: 'When rollback is unsafe — new data formats already written that old code cannot read, destructive migration applied, or external contracts changed (webhooks sent in the new format). Also when the fix is a one-line config change that is faster than a full rollback. Default is still rollback.',
        },
      ],
      pitfalls: [
        'Starting to read logs and debug before mitigating user impact.',
        'Assuming rollback reverts the database migration.',
        'Running kubectl rollout undo in a GitOps setup and being surprised when the bad version comes back.',
        'Only looking at averages, not per-endpoint p99 split by version.',
      ],
    },
    {
      id: 'deployment-infra-iq-02',
      difficulty: 'expert',
      question:
        'Design the release process for a payments API that deploys 20 times a day, must never have customer-visible downtime, and where a bad release must be contained to under 1% of transactions.',
      whatInterviewerLooksFor: [
        'Separates deploy from release; uses flags and canary together',
        'Quantifies blast radius and detection time with real numbers',
        'Handles schema compatibility (expand/contract) and rollback safety',
        'Chooses meaningful analysis metrics including business KPIs',
        'Mentions low-traffic statistical problems and guardrails',
      ],
      modelAnswer: `### Pipeline
1. **Build**: immutable image per commit, SBOM + vulnerability scan, signed; manifests updated in git (Argo CD syncs).
2. **Pre-prod**: contract tests against consumers (Pact), migration dry-run on a prod-sized snapshot.
3. **Deploy via Argo Rollouts canary**: 1% → 5% → 25% → 50% → 100%, pauses of 5–10 min, traffic routing at the ingress/mesh for exact weights.
4. **Background analysis** on canary vs stable: 5xx rate, p99, **payment authorisation success rate**, and downstream PSP error codes. Abort on the second failed 1-minute measurement.

### Containing to < 1% of transactions
- Say 400 TPS peak. At 1% canary weight that's 4 TPS; detection within ~2 analysis intervals (2 min) exposes ~480 transactions ≈ 0.02% of a day's volume, and the canary never exceeds 1% of traffic until analysis has passed. At the 25% step analysis runs again with much higher statistical power.
- Risky behaviour ships **dark behind flags**, ramped per merchant; kill switch in seconds.

### Zero downtime
- \`maxUnavailable: 0\`, PDBs, zone spread; preStop + drain; readiness honest about warm-up.
- **Schema**: expand/contract only; every migration compatible with N-1 and N; migrations run as a separate job before the deploy, with \`lock_timeout\`. Contract steps deploy days later.
- **Idempotency keys** on payment endpoints so retries during pod churn never double-charge.

### Rollback
- Automated abort for canary; flag off for behaviour; \`git revert\` for full rollback. Never write data formats the previous version can't read (new enum values gated by a flag after all readers are upgraded).

### Governance
- Freeze windows only for peak events; DORA metrics (deploy frequency, change failure rate, MTTR) tracked. Twenty small deploys a day is *safer* than one large weekly one — smaller diff, easier attribution.`,
      followUps: [
        {
          q: 'The service only gets 2 TPS at night. Does the canary still work?',
          a: 'Not statistically — 1% of 2 TPS is nothing. Options: deploy during business hours, use larger steps with longer bakes, add synthetic transactions against the canary, or gate on absolute error counts rather than ratios; and set the analysis to treat "no data" as inconclusive, not success.',
        },
        {
          q: 'How do you make sure a canary user does not flip between versions mid-checkout?',
          a: 'Sticky routing: hash on a session/merchant ID or set a cookie/header at the edge so a given session stays on one version; make APIs backward/forward compatible so a flip is survivable anyway.',
        },
        {
          q: 'A new field is added to the Kafka event this service produces. What is the release order?',
          a: 'Upgrade consumers first to tolerate (ignore or use) the new optional field with a schema-registry compatibility check (backward/full), then deploy the producer. For removals, reverse: stop consumers reading it, then stop producing.',
        },
      ],
      pitfalls: [
        'Relying on a human watching dashboards for promotion.',
        'Ignoring schema/data compatibility in rollback.',
        'Blue-green as the whole answer — it exposes 100% of users at the switch.',
        'No business metrics in the canary analysis.',
      ],
    },
    {
      id: 'deployment-infra-iq-03',
      difficulty: 'hard',
      question:
        'After a config change, all new pods of the notification service are in CrashLoopBackOff, and the rollout is stuck at 3 of 12 new pods. What is happening to traffic, and how do you debug and fix it?',
      whatInterviewerLooksFor: [
        'Understands rolling update keeps old pods when new ones never become ready',
        'Systematic triage: describe, logs --previous, exit codes, events',
        'Knows CrashLoopBackOff backoff timings and probe-induced crashes',
        'Fix now vs fix permanently distinction',
      ],
      modelAnswer: `### Traffic impact
With a rolling update the Deployment only removes old pods when new ones become **Ready** (with \`maxUnavailable: 0\` none are removed; with 25% up to 3 might be). So customers are mostly served by old pods — degraded capacity, not an outage. The rollout will eventually exceed \`progressDeadlineSeconds\` (default 600 s) and be marked failed, but Kubernetes does **not** auto-rollback a Deployment; Argo Rollouts would abort.

### Triage in order
1. \`kubectl describe pod\` → Events and **Last State**: exit code and reason.
   - **137 + OOMKilled** → memory limit too low for the new config (bigger batch size?).
   - **137/143 after liveness failures** in events → probe killing a slow-starting app; add a startup probe.
   - **1** → application error: missing secret/env var, config parse error, can't reach a dependency on boot.
   - **127/126** → wrong command/entrypoint.
2. \`kubectl logs <pod> --previous\` — the crashed container's logs, not the fresh one's.
3. Diff the new ReplicaSet's pod template with the old (\`kubectl rollout history --revision\`): env, ConfigMap/Secret refs, resources, image.
4. If it needs interactive digging: \`kubectl debug\` with an ephemeral container, or run the image locally with the same env.

### Fix now
\`kubectl rollout undo\` (or git revert) to stop the churn — crash-looping pods consume scheduling capacity and the backoff (10 s → 20 s → … capped at 5 min) makes each retry slower.

### Fix permanently
- Validate config at build time/CI (schema-validate ConfigMaps, \`@nestjs/config\` with Joi/zod validation to fail fast with a clear message).
- Fail fast on boot with explicit errors; don't retry forever silently.
- Use Argo Rollouts or \`progressDeadlineSeconds\` alerts so stuck rollouts page someone.
- Treat config changes as deploys: versioned, canaried, rollbackable.`,
      followUps: [
        {
          q: 'Logs --previous is empty. What next?',
          a: 'The process died before logging: exit 127/126 (binary not found), a crash in native code, or it was killed by the kernel (OOM during module loading). Check exit code and reason, events for probe kills, and try running the entrypoint via kubectl debug or locally with the same image and env.',
        },
        {
          q: 'Why might the app crash only in Kubernetes and not locally?',
          a: 'Different env/secrets, read-only root filesystem, non-root user lacking permissions to write a temp dir, memory limit lower than the dev machine, DNS/network policies blocking a dependency, or architecture mismatch (arm64 image on amd64 nodes → exec format error).',
        },
      ],
      pitfalls: [
        'Reading logs of the restarted container instead of --previous.',
        'Claiming Kubernetes automatically rolls back failed Deployments.',
        'Deleting pods repeatedly hoping they recover.',
      ],
    },
    {
      id: 'deployment-infra-iq-04',
      difficulty: 'expert',
      question:
        'Your Node API pods show 35% average CPU utilisation, yet p99 latency has periodic 100 ms spikes and the SRE says the pods are "being throttled". Explain exactly what is happening and what you would change.',
      whatInterviewerLooksFor: [
        'Explains CFS quota/period mechanics precisely',
        'Knows Node is multi-threaded at OS level (GC, libuv pool)',
        'Uses the right metrics to confirm (throttled periods)',
        'Weighs removing limits vs raising them vs cluster policy',
      ],
      modelAnswer: `### Mechanism
A CPU **limit** is enforced by the Linux CFS bandwidth controller as a **quota per period** (default period 100 ms). With \`limits.cpu: 1\` the container may use 100 ms of CPU time per 100 ms window — summed across *all* its threads. Node is single-threaded for JS but the process has V8 GC helper threads, the libuv threadpool (default 4: crypto, zlib, fs, dns.lookup) and more. During a burst — say a major GC plus a JSON serialisation spike — 4 threads can burn the 100 ms quota in ~25 ms of wall clock. The kernel then **freezes the whole cgroup** for the rest of the period: ~75 ms during which no request progresses. Averaged over a minute, utilisation looks like 35%. The latency histogram shows exactly those ~75–100 ms spikes.

### Confirm
- \`rate(container_cpu_cfs_throttled_periods_total[5m]) / rate(container_cpu_cfs_periods_total[5m])\` per pod — anything > ~5–10% on a latency-sensitive service is significant.
- \`cat /sys/fs/cgroup/cpu.stat\` → \`nr_throttled\`, \`throttled_usec\`.
- Correlate spikes with GC pauses (\`--trace-gc\` or perf_hooks GC observer).

### Fix options
1. **Remove the CPU limit, keep an accurate request** — the request still guarantees the pod's share under contention; limits mostly buy predictability for noisy multi-tenant clusters. Many orgs do this for latency-critical services.
2. If policy requires limits: raise the limit well above the request (e.g. request 1, limit 3) to absorb bursts.
3. Reduce parallel CPU bursts: smaller \`UV_THREADPOOL_SIZE\` where appropriate, move heavy crypto/compression off the request path, tune heap to reduce major GCs.
4. Scale horizontally so per-pod bursts are smaller.

### Trade-off
Without limits a buggy pod can starve neighbours on the node up to the node's capacity — mitigate with accurate requests, per-namespace ResourceQuotas and alerting on usage >> request.`,
      followUps: [
        {
          q: 'Would setting requests = limits (Guaranteed QoS) fix it?',
          a: 'No — it improves eviction priority and allows exclusive CPUs with the static CPU manager policy, but the CFS quota still applies; a Guaranteed pod with limit 1 is throttled exactly the same way. Integer CPUs with static CPU manager pin cores, which helps cache locality, but bursts beyond the quota still throttle.',
        },
        {
          q: 'How does this interact with HPA?',
          a: 'HPA uses usage/request. If throttled, usage is capped at the limit, so utilisation may never exceed the target and HPA never scales out, while latency suffers. Use latency/RPS-based custom metrics or fix the limit.',
        },
      ],
      pitfalls: [
        'Saying Node is single-threaded so it can only use one core and throttling cannot happen.',
        'Looking only at average CPU utilisation.',
        'Confusing CPU throttling with node-level CPU contention (steal time).',
      ],
    },
    {
      id: 'deployment-infra-iq-05',
      difficulty: 'hard',
      question:
        'Marketing sends a push notification to 20 million users at 8 pm; traffic goes from 2k to 25k RPS in 90 seconds. Last time the HPA "didn\'t work" and we had 12 minutes of errors. Why, and what do you build?',
      whatInterviewerLooksFor: [
        'Breaks down HPA reaction time into its stages',
        'Knows node provisioning dominates when the cluster is full',
        'Proposes predictive/scheduled scaling and headroom',
        'Checks downstream limits (DB connections) before blindly scaling',
        'Adds load shedding as a safety net',
      ],
      modelAnswer: `### Why reactive HPA failed
The chain for a 12× spike:
- metrics lag 15–60 s (rate windows), HPA sync up to 15 s;
- default \`scaleUp\` policy caps growth (max(100%, 4 pods) per 15 s) — from 10 pods to 125 takes several doublings;
- the cluster had no room → Cluster Autoscaler/Karpenter provisions nodes: **1–3 min**;
- image pull 20–40 s on fresh nodes, app boot + startup probe 30 s;
- meanwhile overloaded pods failed readiness/liveness under load → **fewer** pods serving → death spiral. 12 minutes is typical when probes also restart pods.

### What to build
1. **Scheduled/predictive pre-scaling**: the send is planned — the campaign tool calls an API (or KEDA cron scaler) to raise \`minReplicas\` to the needed count 15 min before the send. Capacity math: 25k RPS ÷ 300 RPS per pod at 60% target ≈ 84 pods.
2. **Headroom & balloon pods**: low-priority placeholder pods reserve node capacity; real pods preempt them instantly, CA replaces the balloons in the background.
3. **Faster scale-up**: \`behavior.scaleUp\` 100%/15 s with no stabilisation, RPS-per-pod metric instead of CPU, small images pre-pulled on nodes, fast boot.
4. **Protect downstream**: 84 pods × 10 DB connections = 840 — check Postgres/PgBouncer limits; pre-warm caches for the notification's target content.
5. **Load shedding**: at the gateway, admission control by priority (serve the deep-link landing, shed recommendations), 429/503 with Retry-After; kill-switch flags for expensive features.
6. **Spread the send**: ask for the push to go out over 5–10 minutes (jittered batches) — the cheapest fix of all.
7. Lenient liveness so overloaded pods aren't restarted.`,
      followUps: [
        {
          q: 'Why not just set minReplicas to peak all the time?',
          a: 'Cost: running 84 pods for a 20-minute daily spike means ~90% idle spend. Scheduled scaling or pre-scale via API captures the same safety for the event window only; keep modest permanent headroom for unplanned spikes.',
        },
        {
          q: 'KEDA vs HPA?',
          a: 'KEDA is an operator that feeds external metrics (Kafka lag, SQS, Prometheus, cron) into an HPA it manages and can scale to/from zero. It does not remove HPA mechanics or node provisioning lag; it makes signal selection and scheduled scaling easier.',
        },
      ],
      pitfalls: [
        'Assuming HPA reacts in seconds.',
        'Scaling the API tier without checking DB connection limits.',
        'Ignoring that the spike is predictable and can be pre-scaled or smoothed.',
      ],
    },
    {
      id: 'deployment-infra-iq-06',
      difficulty: 'hard',
      question:
        'Every deploy of our API produces a few hundred 502s at the ingress, even with maxUnavailable 0. The team suspects Kubernetes is broken. What\'s really going on?',
      whatInterviewerLooksFor: [
        'Knows endpoint removal and SIGTERM are concurrent, not ordered',
        'Explains the preStop sleep and drain sequence',
        'Identifies PID 1 / signal handling problems',
        'Mentions keep-alive timeout mismatch with the LB',
      ],
      modelAnswer: `### Root cause: the termination race
When a pod is deleted, two things start **at the same time**: the EndpointSlice controller removes it from the Service, and the kubelet starts shutdown (preStop, then SIGTERM). Endpoint removal then has to propagate to kube-proxy on every node, the ingress controller and any mesh sidecars — typically 1–10 s. If the app exits (or stops accepting) on SIGTERM immediately, the ingress keeps sending requests to a closed socket for those seconds → **502 / connection refused**. \`maxUnavailable: 0\` only guarantees capacity, not graceful handover.

### Other contributors I'd check
- **PID 1 signal handling**: \`CMD npm start\` or shell form → SIGTERM not forwarded, app gets SIGKILLed at 30 s mid-request. Or the opposite: handler calls \`process.exit()\` immediately.
- **Keep-alive mismatch**: Node's default \`keepAliveTimeout\` is 5 s; an ALB keeps idle connections 60 s. Node closes a socket just as the LB reuses it → 502s that spike during deploys and appear randomly otherwise.
- **Readiness lies on startup**: new pods go Ready before caches/connections are warm → first requests time out.

### Fix
1. \`preStop\` sleep 5–15 s so propagation finishes while the app still serves.
2. On SIGTERM: stop accepting new connections, mark not-ready, drain in-flight with a deadline, then close pools/consumers; exit before \`terminationGracePeriodSeconds\` (raise to 45 s).
3. Exec-form CMD + tini, NestJS \`enableShutdownHooks()\`.
4. \`keepAliveTimeout\` 65 s > LB idle timeout; \`headersTimeout\` above that.
5. Verify with a load test (k6 at constant RPS) during a rollout: target zero non-2xx.`,
      followUps: [
        {
          q: 'Why not just fail the readiness probe on SIGTERM instead of sleeping?',
          a: 'Kubernetes already removes a terminating pod from endpoints regardless of readiness, so failing readiness adds nothing for Service routing; the problem is propagation delay. Sleep is the thing that buys time. Failing readiness can still help external LBs that health-check pods directly.',
        },
        {
          q: 'What about WebSocket connections that live for hours?',
          a: 'You cannot drain them in 30 s: send a reconnect/close frame with jitter so clients reconnect to other pods, set a longer grace period if needed, and make clients resilient (exponential backoff reconnect, resume tokens).',
        },
      ],
      pitfalls: [
        'Believing SIGTERM is sent only after the pod is removed from all load balancers.',
        'Adding retries at the ingress as the only fix (masks the problem, unsafe for non-idempotent requests).',
        'Setting a huge grace period without actually draining.',
      ],
    },
    {
      id: 'deployment-infra-iq-07',
      difficulty: 'expert',
      question:
        'Three services read and write the `orders.status` column, which is a free-text string. We need to change it to a foreign key into an `order_statuses` table with zero downtime and the ability to roll back any single deploy. Plan it.',
      whatInterviewerLooksFor: [
        'Expand/contract with explicit N-1/N compatibility per step',
        'Postgres locking awareness (lock_timeout, NOT VALID, CONCURRENTLY)',
        'Batched backfill with lag/lock monitoring',
        'Coordination across three services and rollback windows',
      ],
      modelAnswer: `### Principle
Old and new versions of three services run concurrently during rollouts and after rollbacks. Every step must be safe with **all currently deployable versions**.

### Steps
1. **Expand schema** (migration job, \`lock_timeout = '3s'\` with retries):
   - create \`order_statuses (id smallint pk, code text unique)\` and seed it;
   - \`ALTER TABLE orders ADD COLUMN status_id smallint\` (nullable, metadata-only);
   - \`CREATE INDEX CONCURRENTLY\` on \`status_id\`;
   - FK added \`NOT VALID\` (no scan, brief lock), validated later.
2. **Dual-write** in all three services (deployed independently, any order): write \`status\` *and* \`status_id\`; still read \`status\`. Alternatively a trigger that derives \`status_id\` from \`status\` so un-upgraded writers are covered — useful when you don't control every writer.
3. **Backfill** in batches of ~5k rows by primary key range, throttled on replication lag (< 1 s) and lock waits; idempotent so it can be rerun. Then \`VALIDATE CONSTRAINT\` (SHARE UPDATE EXCLUSIVE — writes continue).
4. **Verify**: a consistency check query (\`status_id\` matches \`status\` mapping) running for a few days; alert on mismatches.
5. **Switch reads** to \`status_id\` service by service, behind a flag so it's instantly reversible.
6. **Stop writing \`status\`** — only after every service reads \`status_id\` and the rollback window for pre-step-5 versions has passed. Before that, make \`status\` nullable (\`DROP NOT NULL\`) so new writers can omit it.
7. **Contract**: drop the trigger and the \`status\` column, weeks later.

### Risks called out
- An \`ALTER\` queued behind a long analytics query blocks all traffic — hence \`lock_timeout\` and running DDL off-peak.
- New status values: insert into \`order_statuses\` *before* any code emits them.
- Replicas/CDC consumers (Debezium) will see the new column — confirm downstream schema compatibility.`,
      followUps: [
        {
          q: 'Why not do it in one migration during a 2-minute maintenance window?',
          a: 'Rewriting a large table with a type change takes an ACCESS EXCLUSIVE lock for the whole rewrite (minutes to hours for 100M rows), and rolling back the app afterwards would break old versions that expect a text column. Expand/contract costs more deploys but no downtime and every step is reversible.',
        },
        {
          q: 'How do you know when the contract step is safe?',
          a: 'No running or rollback-eligible version references the old column: check code search, pg_stat_statements for queries touching it, and optionally revoke write privileges on the column first as a canary before dropping.',
        },
      ],
      pitfalls: [
        'Doing ALTER COLUMN TYPE on a hot table.',
        'Backfilling with one giant UPDATE.',
        'Dropping the old column in the same release that stops reading it.',
      ],
    },
    {
      id: 'deployment-infra-iq-08',
      difficulty: 'medium',
      question:
        'One pod out of 12 in our gRPC-based pricing service runs at 95% CPU while the others sit at 20%. HPA keeps adding pods but the hot pod stays hot. Why?',
      whatInterviewerLooksFor: [
        'Understands L4 Service balancing vs HTTP/2 multiplexing',
        'Considers hot keys / tenant skew and per-pod work differences',
        'Uses per-pod RPS vs CPU to distinguish causes',
        'Proposes client-side LB, mesh, or max connection age',
      ],
      modelAnswer: `### Most likely: connection-level balancing of HTTP/2
A ClusterIP Service balances **TCP connections**, not requests. gRPC clients open one long-lived HTTP/2 connection and multiplex every call over it. If a big client (e.g. the checkout service's pods) established its connections when only a few pricing pods existed, those connections stay pinned forever. New pods from HPA receive no traffic from existing clients — so average CPU across pods stays high, HPA keeps scaling, and nothing improves.

### Distinguish causes with data
- **Per-pod RPS vs CPU**: hot pod has 5× the RPS of others → balancing problem. Same RPS but 5× CPU → per-request work differs (hot key, a particular tenant's huge catalogue, runaway regex, GC thrash near the memory limit).
- \`kubectl top pod\`, \`sum by (pod) (rate(grpc_server_handled_total[1m]))\`, and a CPU profile of the hot pod (\`--cpu-prof\` / 0x flame graph).

### Fixes for balancing
1. **Client-side load balancing**: headless Service + gRPC \`round_robin\` policy so clients resolve all pod IPs and spread calls (needs periodic re-resolution).
2. **Service mesh** (Envoy/Linkerd) balances per request over the pool.
3. **Server-side \`maxConnectionAge\`** (e.g. 5 min with a grace) so clients reconnect periodically and spread naturally.
4. HPA on a better metric (RPS per pod) — but fix balancing first; HPA can't fix skew.

### Fixes for hot keys
Cache the hot computation, split the tenant's work, or add randomness to the shard key.`,
      followUps: [
        {
          q: 'Would switching the Service to IPVS mode with least-connections fix it?',
          a: 'Only partially: it balances new connections better, but existing long-lived connections remain pinned and one connection can carry wildly different request rates. Per-request balancing needs L7.',
        },
        {
          q: 'Could the same happen with REST over HTTP/1.1 keep-alive?',
          a: 'Yes, to a lesser degree: keep-alive pools pin connections too, but clients usually hold many connections and churn them, so the skew is milder. It shows up clearly after scale-out when old connections persist.',
        },
      ],
      pitfalls: [
        'Blaming the HPA or raising maxReplicas.',
        'Assuming kube-proxy balances each gRPC request.',
        'Not checking per-pod RPS before profiling.',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'deployment-infra-boe-1',
      question:
        'A flash sale will take the catalog API from 3k to 36k RPS within 2 minutes. Each pod was load-tested at 500 RPS before p99 degrades. How many pods and nodes must be ready before the sale, and what does reactive HPA alone cost you?',
      assumptions: [
        'Target 60% of tested capacity per pod for headroom → 300 RPS/pod',
        'Pod requests: 1 vCPU, 1.5 GiB; nodes: 16 vCPU / 64 GiB with ~14 vCPU allocatable',
        'Node provisioning ≈ 2 min; pod start (pull + boot + probes) ≈ 45 s',
        'Pods spread across 3 AZs; must survive losing one AZ at peak',
      ],
      steps: [
        { label: 'Pods for peak at target', calc: '36,000 ÷ 300 = 120 pods' },
        { label: 'AZ-loss headroom', calc: 'survive 1 of 3 AZs → 120 × 3/2 = 180 pods (or accept 120 at ~450 RPS each in degraded mode = 90% tested capacity)' },
        { label: 'Nodes needed', calc: '180 pods × 1 vCPU ÷ 14 allocatable ≈ 13 nodes (+ daemonsets) → ~14–15 nodes; memory 180 × 1.5 = 270 GiB ≪ 15 × 60 GiB' },
        { label: 'Baseline today', calc: '3,000 ÷ 300 = 10 pods ≈ 1 node' },
        { label: 'Reactive HPA timeline', calc: 'metric lag ~30 s + sync 15 s + node provisioning 120 s + pod start 45 s ≈ 3.5 min; doubling policy 10→20→40→80→160 needs 4 steps' },
        { label: 'Exposure', calc: 'traffic reaches 36k at t=2 min; capacity catches up at ~t=4 min → ~2 min at 3–10× overload ≈ 36,000 × 120 s ≈ 4.3M requests at risk' },
      ],
      answer:
        'Pre-scale to ~120 pods (180 if the sale must survive an AZ loss) on ~14 nodes at least 15 minutes before the sale; reactive HPA alone leaves ~2–4 minutes of overload affecting millions of requests.',
      insight:
        'For predictable spikes, capacity must be provisioned ahead (scheduled minReplicas, balloon pods); HPA is the safety net for the unpredictable part. Node provisioning, not the HPA loop, dominates reaction time — and the DB behind 120 pods needs checking too.',
      followUps: [
        {
          "q": "Marketing can't give a time: the spike may come any time in a 6-hour window. Pre-scaling for 6 hours costs too much. What now?",
          "a": "Keep a cheaper floor and shorten reaction time: pre-provision nodes, not pods, using low-priority balloon pods (pause containers) occupying ~14 nodes, which are evicted instantly when real pods need room, so the 2-minute node provisioning disappears. Run a minimum of ~40 pods (12K RPS). Then the HPA needs only pod start (~45 s) plus metric lag, about 1.5 minutes to reach 120. Add aggressive scale-up policies (e.g. +100% every 15 s), and load shedding (429 with Retry-After) at the ingress to cover the remaining gap."
        },
        {
          "q": "The 120 pods each open a DB pool of 10 and read the catalog from Postgres. Did you check the database?",
          "a": "120 × 10 = 1,200 connections, likely beyond max_connections, so a pooler is needed (PgBouncer at ~150–200 server connections). More important is query load: 36K RPS hitting the catalog DB directly would melt it. The catalog is read-mostly, so it should be served from cache: a CDN for product pages and Redis or in-process caching for API reads at a ~99% hit rate, leaving ~360 DB reads/s. Pre-warm caches before the sale, and load test the full path, not only the pods."
        }
      ],
    },
    {
      id: 'deployment-infra-boe-2',
      question:
        'How long does a rolling deploy of 60 pods take with maxSurge 25%, maxUnavailable 0, and how long with a 5-step Argo canary? Is it worth it for 20 deploys/day?',
      assumptions: [
        'Pod becomes Ready 50 s after creation (pull cached 5 s + boot 30 s + readiness 15 s)',
        'Old pod termination: preStop 10 s + drain ≤ 15 s, overlaps with next batch',
        'Canary steps: 5% (5 min), 25% (10 min), 50% (10 min), 100% (scale-up time)',
        'Canary scaled via traffic routing; full canary ReplicaSet brought up progressively',
      ],
      steps: [
        { label: 'Surge batch size', calc: '25% of 60 = 15 pods at a time' },
        { label: 'Rolling batches', calc: '60 ÷ 15 = 4 batches' },
        { label: 'Rolling duration', calc: '4 × ~50 s (Ready) ≈ 200 s ≈ 3.5 min (+ drain tail ~25 s) ≈ 4 min' },
        { label: 'Canary bake time', calc: '5 + 10 + 10 = 25 min of pauses' },
        { label: 'Canary total', calc: '25 min + ~3 scale-ups × ~1 min ≈ 28 min' },
        { label: 'Daily pipeline time', calc: '20 deploys × 28 min ≈ 9.3 h of canary time/day → deploys must pipeline (queue) or batch' },
        { label: 'Blast radius comparison', calc: 'rolling: bad code at 100% within 4 min; canary: 5% for ≤ 2 min before auto-abort → ~40× fewer affected requests' },
      ],
      answer:
        'Rolling ≈ 4 minutes; canary ≈ 28 minutes. With 20 deploys a day, canaries consume ~9 hours of wall time, so you need a deploy queue/merge train or shorter bakes on low-risk services.',
      insight:
        'Canary safety costs time; tune bake time by risk (payments: long bakes; internal tools: rolling). Faster pod readiness directly shortens both strategies, and deploy frequency pushes you towards merge trains or combining changes per canary.',
      followUps: [
        {
          "q": "Pod readiness drops from 50 s to 15 s after image and boot optimisation. Recompute both strategies.",
          "a": "Rolling: 4 batches × ~15 s ≈ 60 s, plus ~25 s drain tail, about 1.5 minutes. Canary: the bake pauses dominate (25 min), and scale-ups shrink from ~1 min to ~20 s each, so the total goes from ~28 to ~26 minutes. Faster readiness transforms rolling deploys but barely changes canaries; to shorten canaries you need faster statistical confidence: more traffic in early steps, sharper metrics (error budget burn rate), or a shorter bake for low-risk changes classified by diff."
        },
        {
          "q": "Two of the 20 daily deploys are bad. With rolling vs canary, roughly how many requests fail per day, assuming 10K RPS and a 10% error rate for bad releases?",
          "a": "Rolling: the bad code reaches 100% in ~4 minutes, and detection plus rollback takes perhaps ~10 minutes, so averaging ~70% exposure over 10 minutes is ~10K × 600 s × 0.7 × 10% ≈ 420K failed requests per bad deploy, ~840K/day. Canary at 5% with a 2-minute auto-abort: 10K × 120 s × 5% × 10% ≈ 6K per bad deploy, ~12K/day. That's ~70× fewer, and that number is what justifies 25 minutes of bake time per deploy."
        }
      ],
    },
    {
      id: 'deployment-infra-boe-3',
      question:
        'The orders service runs 40 pods, each with a Postgres pool of 20. Postgres max_connections is 500. What happens during a deploy with maxSurge 25%, and during an HPA scale-out to 60 pods?',
      assumptions: [
        'Pools open connections eagerly at boot (min = max = 20)',
        'Old pods keep connections until their drain finishes (~25 s)',
        'Postgres reserves ~10 connections for superuser/replication/monitoring',
        'Each Postgres backend uses ~5–10 MB RAM',
      ],
      steps: [
        { label: 'Steady state', calc: '40 × 20 = 800 connections > 490 usable → already broken unless a pooler exists' },
        { label: 'Assume PgBouncer, transaction mode, 150 server conns', calc: 'app side: 800 client conns (cheap), DB side: 150 backends' },
        { label: 'Deploy surge (no pooler)', calc: '(40 + 10 surge) × 20 = 1,000 connections at peak overlap' },
        { label: 'HPA to 60 pods (no pooler)', calc: '60 × 20 = 1,200 → new pods fail "too many clients" → CrashLoop or not Ready' },
        { label: 'Backend memory', calc: '1,200 × ~8 MB ≈ 9.6 GB just for connection backends' },
        { label: 'Right-sized DB side', calc: 'Postgres throughput peaks near ~2–4 × cores active connections; 32-core DB → ~100–150 server connections' },
      ],
      answer:
        'Without a pooler the deploy needs ~1,000 and the scale-out ~1,200 connections against a 490 limit — new pods fail to connect exactly when you need them. With PgBouncer (transaction pooling) the DB sees a fixed ~150 backends regardless of pod count.',
      insight:
        'Horizontal scaling of stateless pods multiplies connection counts; surge and autoscale make it worse at the worst time. Budget connections per pod (total ÷ max pods incl. surge), use a pooler, and include the DB in HPA maxReplicas decisions.',
      followUps: [
        {
          "q": "You put PgBouncer in front with 150 server connections, and peak traffic needs 300 concurrently active queries. What does the app see?",
          "a": "PgBouncer queues the excess: 150 queries run and 150 wait for a free server connection, so latency includes pool wait time. That is the intended behaviour, because Postgres on 32 cores would be slower running 300 at once. But if the wait gets long, app pool timeouts fire and requests fail. Watch `SHOW POOLS` (`cl_waiting`, `maxwait`), set `query_wait_timeout` (e.g. 5 s) so clients fail fast, and fix the demand: shorter transactions, fewer queries per request, read replicas for read traffic."
        },
        {
          "q": "You keep direct connections but shrink the pool per pod. What's the right per-pod size, and what does it cost you?",
          "a": "Budget = (max_connections − reserved) ÷ max pods including surge: 490 ÷ (60 + 25% surge = 75) ≈ 6 per pod. Six connections per pod caps each pod at 6 concurrent queries, so a pod handling 300 RPS at 10 ms per query needs only ~3 busy on average, which is fine. Bursts or slow queries quickly exhaust it, though, and requests wait on the pool. And maxReplicas is capped by the DB rather than by demand. That's acceptable for small fleets; beyond ~50 pods, a pooler is the better answer."
        }
      ],
    },
  ],
  test: [
    {
      id: 'deployment-infra-mcq-01',
      difficulty: 'hard',
      question:
        'During a 25-second Postgres failover, every pod of your service restarted at roughly the same time and the outage lasted 6 minutes instead of 25 seconds. Given this probe config, what is the best explanation?',
      code: {
        language: 'yaml',
        code: `livenessProbe:
  httpGet: { path: /health, port: 3000 }   # runs SELECT 1 on Postgres
  periodSeconds: 10
  failureThreshold: 2
readinessProbe:
  httpGet: { path: /health, port: 3000 }
  periodSeconds: 10`,
      },
      options: [
        'Readiness removed all pods from the Service, and Kubernetes restarts pods that are NotReady for more than 20 seconds.',
        'failureThreshold 2 is below the minimum of 3, so the kubelet ignored it and killed the pods after the first failure.',
        'Liveness depends on the DB, so the failover failed liveness fleet-wide; simultaneous restarts caused cold caches, boot-time connection storms and probe churn that outlasted the failover.',
        'The failover changed the DB IP; the restart was needed to refresh DNS, and the 6 minutes was DNS TTL expiry.',
      ],
      correct: [2],
      explanation:
        'Liveness failures restart containers, and because every pod checks the same shared dependency the failures are correlated — the whole fleet restarts, then reconnects and rewarms at once, extending the outage. Readiness failures never restart pods (they only remove endpoints). failureThreshold 2 is valid (minimum is 1). DNS/IP changes are handled by reconnect logic, not restarts, and would not explain a fleet-wide simultaneous restart.',
      followUps: [
        {
          "q": "You make liveness process-local. Should readiness still check Postgres during that 25-second failover?",
          "a": "Be careful. If readiness checks the DB, all pods go NotReady at once during the failover, the Service has zero endpoints, and the ingress returns 503 for everything, including routes that don't need the DB (cached product pages, static config). Often better: readiness reflects only the pod's ability to serve (booted, not shutting down, not overloaded), and DB errors surface as fast 503s per request behind a circuit breaker. If you do include dependencies, apply them per pod with hysteresis, never as a fleet-wide shared check."
        },
        {
          "q": "How would you test that the service now survives a DB failover gracefully, before the next real one?",
          "a": "Run a chaos test in staging (then in production with guardrails): trigger an actual failover (`aws rds failover-db-cluster`, or Patroni switchover), or block port 5432 with a NetworkPolicy or Toxiproxy for 30 s, under realistic load. Assert that pod restart counts stay at 0, that error rate returns to baseline within ~10 s of the DB recovering, and that connection count to the new primary ramps smoothly rather than spiking. Put it in a recurring game day so regressions in probe config get caught."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-02',
      difficulty: 'expert',
      question:
        'A Node service has `limits.cpu: 500m`, average CPU usage of 180m, and p99 latency spikes of ~80 ms. Which observation most directly confirms CFS throttling as the cause?',
      options: [
        'container_cpu_usage_seconds_total shows usage never exceeds 0.5 cores in 1-minute averages.',
        'The ratio of container_cpu_cfs_throttled_periods_total to container_cpu_cfs_periods_total is ~20% and correlates with the latency spikes.',
        'Node-level CPU steal time is high on the host running the pods.',
        'Event-loop lag p99 is high even when request rate is low.',
      ],
      correct: [1],
      explanation:
        'Throttled periods as a fraction of total periods is the direct evidence that the cgroup exhausted its quota within 100 ms windows. One-minute averages hide sub-second bursts, so "never exceeds 0.5 cores" is consistent with heavy throttling rather than evidence against it. Steal time indicates hypervisor contention, a different problem. Event-loop lag can be caused by throttling but also by blocking code, so it does not confirm the mechanism on its own.',
      followUps: [
        {
          "q": "Throttling is confirmed at 20% of periods. You can't remove CPU limits because the platform team enforces them. What can you do inside the limit?",
          "a": "Reduce bursts and parallelism inside the quota: Node's libuv pool (`UV_THREADPOOL_SIZE`, default 4) and V8's parallel GC threads all burn the same 50 ms per 100 ms budget, so a GC pause plus crypto work can exhaust it in 20 ms. Set the limit to a whole number of cores matching actual burst (e.g. 1000m–2000m) since average use is only 180m, cap V8 threads (`--v8-pool-size`), and move CPU-heavy work (bcrypt, JSON of huge payloads) off the request path. Re-measure the throttled ratio; target under ~1–2%."
        },
        {
          "q": "How would you alert on this so the next service doesn't need an SRE to spot it?",
          "a": "Create a Prometheus recording rule per container: `rate(container_cpu_cfs_throttled_periods_total[5m]) / rate(container_cpu_cfs_periods_total[5m])`. Alert when it exceeds ~5% for 15 minutes on latency-sensitive services. Add it to the standard service dashboard next to p99 and event-loop lag, so the correlation is visible at a glance. Pair it with a CI or admission-policy check that flags CPU limits below ~1 core on Node services, catching the misconfiguration before deploy."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-03',
      difficulty: 'hard',
      question:
        'A pod restarts repeatedly; `kubectl describe` shows `Last State: Terminated, Reason: OOMKilled, Exit Code: 137`, memory limit 1Gi, and the Node process runs with default heap settings on a 64 GiB node running an old Node version. What is the most effective first fix?',
      options: [
        'Add a liveness probe with a longer timeout so the kubelet stops killing the container.',
        'Increase terminationGracePeriodSeconds so the app can flush memory before exit.',
        'Set --max-old-space-size to roughly 70–75% of the container limit (and verify the real working set), so V8 collects garbage before the cgroup limit is hit.',
        'Remove the memory limit and rely on requests, as with the CPU limit.',
      ],
      correct: [2],
      explanation:
        'OOMKilled comes from the kernel cgroup OOM killer, not the kubelet or probes, so probe tuning and grace periods are irrelevant (SIGKILL gives no grace). Old Node versions size the heap from host memory, so V8 happily grows past 1Gi before full GCs; capping the heap below the limit fixes that. Removing memory limits is dangerous: memory is incompressible, and an unbounded pod can trigger node-level OOM and evictions of other workloads.',
      followUps: [
        {
          "q": "You set `--max-old-space-size=768` with a 1Gi limit. The pod still gets OOMKilled occasionally. Where is the rest of the memory going?",
          "a": "The heap limit covers only V8's old space. RSS also includes new space (semi-spaces, ~16–64 MB), code space, Buffers and ArrayBuffers allocated off-heap (large file uploads, gzip, crypto), native addons, and thread stacks. A service streaming big payloads into Buffers can add hundreds of MB outside the heap. Compare `process.memoryUsage()` (`rss` against `heapUsed` against `external`/`arrayBuffers`) in metrics. Fix by streaming instead of buffering, bounding concurrency of large requests, or giving more headroom (e.g. heap 60% of limit)."
        },
        {
          "q": "How do you tell a genuine memory leak from a heap that's simply sized too large for the limit?",
          "a": "Plot heap used after each major GC over hours. A leak shows a steadily rising floor across GCs and traffic cycles; an over-sized heap shows a sawtooth that reaches the limit under load but returns to a stable floor. For a leak, take two heap snapshots (`--heapsnapshot-signal` or the inspector) 30 minutes apart on one pod and diff retained objects: typical culprits are unbounded in-memory caches, listeners added per request and closures held by timers. A restart \"fixing it\" for a few hours is also a leak signature."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-04',
      difficulty: 'expert',
      question:
        'Your HPA targets 70% CPU. Pods request 200m but actually need ~800m at normal load; there is no CPU limit. What behaviour do you expect?',
      options: [
        'HPA sees ~80% utilisation and adds a few pods — correct behaviour, since requests don\'t matter without limits.',
        'HPA cannot compute utilisation without a CPU limit, so it reports <unknown> and never scales.',
        'HPA caps utilisation at 100% because usage above requests is not counted.',
        'HPA sees ~400% utilisation and scales towards maxReplicas even at normal load, while scheduling packs too many pods per node.',
      ],
      correct: [3],
      explanation:
        'Utilisation is usage divided by request: 800m / 200m = 400%, so desired replicas = current × 400/70 ≈ 5.7× current — it races to maxReplicas. The scheduler also uses requests, so it overcommits nodes. HPA needs requests, not limits, to compute utilisation (missing requests produce <unknown>), and usage above the request is counted.',
      followUps: [
        {
          "q": "You raise requests to the real 800m. What happens to cost and to node packing, and how do you pick the number properly?",
          "a": "Each pod now reserves 4× more CPU, so the same nodes fit about a quarter of the pods and the cluster autoscaler adds nodes. That's the honest cost of what the pods were already consuming by stealing from neighbours. Pick requests from data: the p90–p95 of per-pod CPU usage over a week at normal load (Vertical Pod Autoscaler in recommendation mode reports exactly this), then set the HPA target at ~60–70% of that. Revisit after big releases, because code changes shift CPU per request."
        },
        {
          "q": "Instead of CPU, the team suggests scaling on requests per second per pod. When is that better?",
          "a": "When CPU isn't the bottleneck or isn't proportional to load: I/O-bound services waiting on downstream calls, or pods whose CPU is distorted by GC or background jobs. RPS per pod (from the ingress or app metrics via the Prometheus adapter, or KEDA) tracks the load directly, and you set the target from load tests (e.g. 300 RPS/pod). The risk: if the cost per request changes (a heavier endpoint mix, a slow release), RPS-based scaling won't react. Many teams scale on RPS with CPU as a second metric; HPA takes the maximum."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-05',
      difficulty: 'hard',
      question:
        'Select ALL that apply: which changes reduce the 502s seen at the ingress during each rolling deploy of a Node service?',
      options: [
        'Add a preStop sleep of ~10 s so endpoint removal propagates before the app stops accepting connections.',
        'Set server.keepAliveTimeout higher than the load balancer\'s idle timeout.',
        'Change the container command from `npm start` to exec-form `["node", "dist/main.js"]` with a SIGTERM handler that drains in-flight requests.',
        'Set maxSurge to 100% so all new pods start at once.',
        'Lower terminationGracePeriodSeconds to 5 s so old pods disappear faster.',
      ],
      correct: [0, 1, 2],
      explanation:
        'The preStop delay closes the race between endpoint propagation and SIGTERM; the keep-alive fix prevents the server closing sockets the LB is about to reuse; exec-form plus a drain handler ensures SIGTERM is received and in-flight requests finish. maxSurge 100% changes rollout speed and capacity use but not the termination race. A shorter grace period makes things worse by SIGKILLing requests mid-flight.',
      followUps: [
        {
          "q": "You add all three fixes. How do you prove the deploy is now 502-free, rather than assume it?",
          "a": "Run a load test during a deploy: keep a constant load of a few hundred RPS through the real ingress or ALB (k6 or vegeta), trigger a rollout of all pods, and count non-2xx responses and connection resets on the client side, which should be zero. Also check ALB metrics (`HTTPCode_ELB_502_Count`, `TargetConnectionErrorCount`) for the deploy window. Make it a CI or staging gate run on every change to the Dockerfile, Helm chart or server bootstrap, because these fixes regress easily (someone switches back to `npm start`)."
        },
        {
          "q": "The same service also runs behind an NGINX ingress, not just the ALB. Does the keepAliveTimeout rule still apply, and with what value?",
          "a": "Yes. The rule is that the upstream server must keep idle connections open longer than the proxy that reuses them. For NGINX, the relevant setting is `upstream-keepalive-timeout` (default 60 s in ingress-nginx), so Node's `keepAliveTimeout` must be above it (e.g. 65 s), with `headersTimeout` slightly higher still. Each proxy hop has its own pool and timeout, so check every hop: the ALB to NGINX, then NGINX to pod. Only the hop directly in front of Node is governed by Node's setting."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-06',
      difficulty: 'medium',
      question:
        'You need to validate a rewritten search service against real production traffic patterns, with zero user impact, before any user sees its results. Which strategy fits best?',
      options: [
        'Canary at 1% with automated analysis.',
        'Blue-green with a smoke test on green before switching.',
        'Traffic mirroring (shadowing) to the new version, discarding its responses and comparing latency/results offline.',
        'A rolling update with maxUnavailable 0.',
      ],
      correct: [2],
      explanation:
        'Mirroring sends a copy of real requests to the new version while users only receive responses from the old one — zero user impact with realistic load, and search is read-only so duplicated side effects are not a concern. A 1% canary still shows results to real users. Blue-green smoke tests use synthetic traffic, and the switch exposes everyone. Rolling updates serve users from new pods immediately.',
      followUps: [
        {
          "q": "Shadowing looks good on latency. How do you compare result quality between old and new search, given results won't be byte-identical?",
          "a": "Log both responses keyed by a request id, then compute ranking metrics offline instead of an exact diff: overlap of top-10 result ids (Jaccard), rank correlation, and the share of queries where the top result differs. Sample the differing queries for human review. Where you have click logs, replay historical queries and compute NDCG against the documents users actually clicked. Set thresholds (e.g. top-3 overlap ≥ 90%) before promoting to a canary, which then measures real user engagement such as CTR and zero-result rate."
        },
        {
          "q": "Next, you must validate a rewritten checkout service the same way. Can you still mirror traffic?",
          "a": "Not naively: checkout has side effects. Mirrored requests would charge cards twice, send emails and decrement stock. Options: shadow into a sandboxed environment where payment, email and inventory clients are stubbed or point to test doubles, comparing the computed totals and validation decisions; or run the new code in \"dark\" mode inside the old service, computing its result and logging differences without acting on it. Then progress to a small canary with real side effects, behind idempotency keys and fast rollback."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-07',
      difficulty: 'expert',
      question:
        'What is wrong with this Argo Rollouts analysis for a low-traffic internal service (≈1 RPS at night)?',
      code: {
        language: 'yaml',
        code: `metrics:
  - name: error-rate
    interval: 1m
    failureLimit: 3
    successCondition: result[0] < 0.01
    provider:
      prometheus:
        query: |
          sum(rate(http_requests_total{svc="api-canary",code=~"5.."}[1m]))
          / sum(rate(http_requests_total{svc="api-canary"}[1m]))`,
      },
      options: [
        'rate() over 1m is invalid in Prometheus; the minimum range is 5m.',
        'At 5% weight the canary receives ~0.05 RPS, so the query often returns empty/NaN or is based on a handful of requests — analysis may pass with no real signal. It needs a minimum-sample guard and longer windows or synthetic traffic.',
        'failureLimit 3 means the rollout aborts after the first failed measurement, making it too sensitive.',
        'successCondition must use result.value, not result[0], for Prometheus providers.',
      ],
      correct: [1],
      explanation:
        'The real risk is statistical: a few requests per minute cannot detect a 1% regression, and a query with no data produces an empty/NaN result that must be treated explicitly rather than silently passing. rate over 1m is valid (it just needs at least two scrapes in the window). failureLimit 3 tolerates three failures and aborts on the fourth, i.e. it is lenient, not strict. result[0] is the documented way to index a Prometheus vector result.',
      followUps: [
        {
          "q": "Write the guard: how should the analysis treat an empty or NaN result, and how many requests do you need before trusting it?",
          "a": "Make the query return a value even with no traffic, and fail closed or extend when the sample is small. For example, add a second metric `sum(increase(http_requests_total{svc=\"api-canary\"}[10m]))` with `successCondition: result[0] >= 200` and `inconclusiveLimit`, so the rollout pauses as inconclusive instead of passing. To detect error rates above 1% with confidence you need roughly a few hundred requests at minimum. Use `isNaN(result[0])` handling explicitly in the condition so empty data never counts as a success."
        },
        {
          "q": "Error rate is fine, but the canary is 30% slower at p99. Would this analysis catch it, and what would you add?",
          "a": "No: it only checks errors. Add a latency metric comparing canary to stable over the same window: `histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{svc=\"api-canary\"}[5m])))` against the stable value, with success if the canary is under stable × 1.2. Comparing to stable (not a fixed threshold) cancels out time-of-day effects. Also add saturation signals, such as CPU per request and DB query count per request, because a regression that doubles DB load passes latency checks at 5% traffic but fails at 100%."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-08',
      difficulty: 'hard',
      question:
        'Select ALL that apply: after `kubectl rollout undo` on a service deployed with Argo CD (auto-sync enabled), which statements are true?',
      options: [
        'Argo CD will detect drift from git and re-apply the bad image unless you revert the commit or pause auto-sync.',
        'The undo reuses the previous ReplicaSet, so pods come up with the old pod template.',
        'The undo also reverts the database migration that shipped with the release.',
        'ConfigMap changes referenced by name (not versioned) stay at their new values, so the old code may run with new config.',
      ],
      correct: [0, 1, 3],
      explanation:
        'With auto-sync, git is the source of truth, so a manual undo is overwritten — revert in git. rollout undo scales the previous ReplicaSet back up using its pod template. Only the pod template is reverted: separately-applied migrations and ConfigMaps mutated in place are not, which is why config should be versioned (hash-suffixed ConfigMaps) and migrations backward compatible.',
      followUps: [
        {
          "q": "Production is burning. What is the fastest correct rollback when Argo CD auto-sync is on?",
          "a": "Revert in git and let Argo sync: `git revert <bad commit>` on the environment repo, then trigger `argocd app sync` instead of waiting for the poll interval. That takes about a minute and keeps git as truth. If even that is too slow, first disable auto-sync for that app (`argocd app set orders --sync-policy none`), run `kubectl rollout undo` or `argocd app rollback` to a previous synced revision, then land the git revert and re-enable auto-sync. Never leave auto-sync off silently; it's a common way to drift for weeks."
        },
        {
          "q": "How do you make ConfigMap changes roll back together with the code?",
          "a": "Make config immutable and versioned with the pod template: Kustomize `configMapGenerator` or Helm templating appends a content hash to the name (`orders-config-7f9c2`), and the Deployment references that name. Any config change creates a new ConfigMap and a new ReplicaSet, so it rolls out and rolls back like code, with canary and readiness gates applied. Old ConfigMaps must be kept (not garbage-collected) for as long as old ReplicaSets can be restored, which `revisionHistoryLimit` bounds."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-09',
      difficulty: 'expert',
      question:
        'A rolling deploy of v42 ran its new Knex migration from the initContainer below. v42 turned out to be buggy, so on-call ran `kubectl rollout undo` back to v41. The v41 pods now sit in Init:CrashLoopBackOff, each init container exiting within a second, and the buggy v42 pods keep serving. A one-off `migrate:latest` from the v42 image against the same database succeeds instantly with nothing to do. Why?',
      code: {
        language: 'yaml',
        code: `# orders-api Deployment (same template in v41 and v42, only the image tag differs)
spec:
  replicas: 24
  strategy:
    rollingUpdate: { maxSurge: 25%, maxUnavailable: 0 }
  template:
    spec:
      initContainers:
        - name: migrate
          image: registry/orders-api:v41   # was :v42 before the undo
          command: ['npx', 'knex', 'migrate:latest']
      containers:
        - name: api
          image: registry/orders-api:v41
# v42 shipped migrations/20260901_add_orders_region.js,
# which v41's image does not contain.`,
      },
      options: [
        'The knex_migrations_lock row was left locked by a v42 pod killed mid-migration, so every v41 init container fails to take the lock.',
        '`kubectl rollout undo` restores only the main container image; the init container still runs the v42 image and re-applies its migration.',
        'v41\'s Knex sees a migration in knex_migrations that its own folder lacks, aborts with "migration directory is corrupt", and no v41 pod ever becomes ready.',
        'Knex runs v42\'s down() migration automatically when it sees an older code version, and the DROP COLUMN fails because v42 pods are still using the column.',
      ],
      correct: [2],
      explanation:
        'Knex validates that every migration recorded in knex_migrations exists on disk; v41 has never heard of 20260901_add_orders_region.js, so migrate:latest throws instantly and the init container crash-loops. With maxUnavailable 0 the old v42 pods are never removed, so the "rollback" leaves the bad code serving. A leftover lock is ruled out because the v42 image\'s migrate:latest takes the same lock and succeeds. The pod template (including initContainers) is reverted as a whole, and Knex never runs down() on its own. Fix: run migrations once as a separate pre-deploy Job, keep them backward compatible (expand/contract) so rollback never needs a down(), and never gate app start-up on the migrator.',
      followUps: [
        {
          "q": "You move migrations to a pre-deploy Job. Two deploys run close together and both Jobs start. What prevents a mess?",
          "a": "Knex's own lock table (`knex_migrations_lock`) serialises them: the second runner waits or fails to acquire the lock, then finds nothing to do. Make sure the Job retries on lock failure (`backoffLimit`) instead of failing the pipeline. Better still, serialise deploys per service in the CD system (one at a time) so migrations and rollouts never interleave. Also set `lock_timeout` in each migration, so a migration waiting on a busy table doesn't block production queries while holding the knex lock."
        },
        {
          "q": "v42's migration was additive, but next week a migration drops a column v41 still reads. How do you sequence that so rollback stays possible?",
          "a": "Expand and contract across releases: release A stops reading and writing the column (code only). Release B, at least one stable release later, drops it. Rollback from B to A is safe because A doesn't need the column, and rolling back from A to the version before it is safe because the column still exists. Add a CI check that rejects destructive DDL (DROP, RENAME, type changes) in the same release as the code that stops using it, and require a reviewer sign-off naming the release that removed usage."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-10',
      difficulty: 'hard',
      question:
        'A container repeatedly restarts with exit code 143 and events show "Liveness probe failed: context deadline exceeded" only under peak load. What is the most likely root cause and fix?',
      options: [
        'The app is OOMKilled; raise the memory limit.',
        'The binary is missing from the image; fix the ENTRYPOINT.',
        'The event loop is saturated under load so the liveness endpoint misses its 1 s timeout; the kubelet sends SIGTERM and the app exits cleanly. Make liveness lenient (longer timeout/threshold) and fix the saturation (scale out, shed load).',
        'The readiness probe is misconfigured; readiness failures send SIGTERM after three attempts.',
      ],
      correct: [2],
      explanation:
        'Exit 143 = 128 + 15 (SIGTERM), i.e. the container was asked to stop and handled it; combined with liveness timeouts under load, the probe is killing busy-but-healthy pods, which removes capacity at peak and cascades. OOM kills show 137 with reason OOMKilled; a missing binary gives 127 at start, not only under load. Readiness failures never send SIGTERM.',
      followUps: [
        {
          "q": "You relax liveness, but the pods are now saturated at peak instead of restarting. What should happen to the excess load instead?",
          "a": "Shed it explicitly and early: an admission limit per pod (max concurrent requests or event-loop-lag based, e.g. reject with 503 when lag > 200 ms) keeps latency bounded for admitted requests. Readiness can briefly drop on sustained overload so the LB spreads traffic elsewhere, with hysteresis so pods don't flap. Meanwhile the HPA scales out on CPU or RPS. Clients must back off with jittered retries and retry budgets, or shed load turns into a retry storm."
        },
        {
          "q": "How do you distinguish \"busy-but-healthy\" from \"truly hung\" so liveness still catches real deadlocks?",
          "a": "Make the liveness endpoint answer from a check that hang conditions break but load doesn't: e.g. a watchdog timestamp updated by a `setInterval` every second, with liveness failing if it hasn't advanced in 30 s. A blocked event loop or deadlocked worker stops the timer; mere queueing doesn't. Combine that with a lenient timeout (5 s) and failureThreshold (6), so it takes ~60 s of real stall to restart. Alert on event-loop lag separately, so overload is a page, not a restart."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-11',
      difficulty: 'medium',
      question:
        'With `replicas: 8`, `maxSurge: 25%` and `maxUnavailable: 25%`, what are the bounds on pod counts during the rollout?',
      options: [
        'At most 8 pods total and at least 6 available pods.',
        'At most 10 pods total and at least 8 available pods.',
        'At most 16 pods total and at least 4 available pods.',
        'At most 10 pods total and at least 6 available pods.',
      ],
      correct: [3],
      explanation:
        '25% of 8 = 2. maxSurge allows 8 + 2 = 10 pods to exist; maxUnavailable allows availability to drop to 8 − 2 = 6. (Surge rounds up and unavailable rounds down for fractional values.) "At least 8 available" would require maxUnavailable 0; 16/4 corresponds to 100%/50%.',
      followUps: [
        {
          "q": "The cluster has room for only one extra pod (resource quota). How does this rollout behave, and what settings would you use?",
          "a": "With maxSurge 2 but room for only 1, the second surge pod stays Pending, so the rollout proceeds using the remaining budget: it can still take down 2 old pods (maxUnavailable 2), dropping capacity to 6 of 8 plus whatever is Pending. If you can't lose capacity, use maxSurge 1 / maxUnavailable 0: one new pod at a time, ~8 cycles, slower but at full capacity. If the quota leaves no surge room at all, maxUnavailable must be ≥ 1 or the rollout deadlocks."
        },
        {
          "q": "Pods take 3 minutes to become ready. Roughly how long does this rollout take, and how do you speed it up safely?",
          "a": "Each cycle replaces up to 2 pods (plus 2 surge), so it needs about 4 cycles of ~3 minutes, ~12 minutes plus `minReadySeconds`. Speed it up by fixing readiness time rather than loosening safety: pre-pull images (or use smaller images), lazy-load or snapshot caches, and tune probe periods so a ready pod is noticed in seconds. Raising maxSurge to 50% halves the cycles at the cost of temporary capacity; raising maxUnavailable reduces capacity during the deploy, which is risky at peak."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-12',
      difficulty: 'expert',
      question:
        'Select ALL that apply: which are real risks of the following feature-flag evaluation in a NestJS request path?',
      code: {
        language: 'typescript',
        code: `async function handle(req: Req) {
  const useNewPricing = await flags.remoteCheck('new-pricing', req.user.id); // HTTP call
  const price = useNewPricing ? await newPricing(req) : await oldPricing(req);
  const tax = (await flags.remoteCheck('new-pricing', req.user.id))
    ? newTax(price) : oldTax(price);
  return { price, tax };
}`,
      },
      options: [
        'Every request adds a network round trip (or two) to the flag service, and a flag-service outage becomes a checkout outage unless there is a timeout and safe default.',
        'Evaluating the same flag twice can yield different values if the flag changes mid-request, producing a price from one path and tax from the other.',
        'Deterministic bucketing is impossible with remote checks, so users will be randomly re-bucketed on every request.',
        'The flag cannot be killed quickly because remote evaluation requires a redeploy to change.',
      ],
      correct: [0, 1],
      explanation:
        'Remote per-request evaluation adds latency and a hard runtime dependency; SDKs evaluate locally from a streamed rule set with fallbacks. Evaluating twice allows inconsistent decisions within one request — evaluate once and pass the decision down. Remote services can still bucket deterministically by hashing the user ID, and remote flags change instantly without redeploy, so the last two are false.',
      followUps: [
        {
          "q": "Rewrite the flag evaluation so it is fast, consistent within a request, and safe when the flag service is down.",
          "a": "Use an SDK that keeps the rule set in memory and receives updates via streaming or polling every ~30 s, so evaluation is a local hash of `user.id` with no network call. Evaluate once at the edge of the handler, `const variant = flags.variation('new-pricing', user, false)`, and pass `variant` into both price and tax. If the SDK has never loaded rules (cold start with the service down), fall back to a default baked into code (`false` = old pricing) and log it. Emit an exposure event per decision for analysis."
        },
        {
          "q": "The new pricing must be consistent across the whole checkout, from basket to payment, spanning several requests and services. How?",
          "a": "Decide once and carry the decision: at basket creation, evaluate the flag and store `pricing_version = v2` on the cart or order record (or in a signed token). Every later request and downstream service reads that stored decision rather than re-evaluating, so a flag flip mid-checkout doesn't switch formulas. A user starting a new cart after the flip gets the new value. This also makes debugging easy: every order records which pricing logic produced it."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-13',
      difficulty: 'expert',
      question:
        'You roll back from v2 to v1 of a service. v2 had started publishing a new enum value `PARTIALLY_REFUNDED` in `order.updated` Kafka events and writing it to the DB. What is the main risk?',
      options: [
        'No risk: rollback restores the old image, and Kafka retention will expire the new messages.',
        'v1 consumers and v1 API code may fail to deserialize or mishandle rows/events with the unknown enum value — rollback does not undo data already written in the new format.',
        'Kafka will reject v1 producers because the topic schema was upgraded by v2.',
        'The Deployment controller refuses to roll back when the pod template references a newer schema version.',
      ],
      correct: [1],
      explanation:
        'Rollbacks revert code, not data. Rows and events carrying the new value remain, and v1 code (and any other consumer) may crash or silently drop them. Safe practice: first deploy readers that tolerate the value, then enable writers behind a flag. Kafka retention does not remove rows from the DB and can take days; schema registries check compatibility on registration but do not block an older compatible producer; Kubernetes has no notion of data schemas.',
      followUps: [
        {
          "q": "Rows with PARTIALLY_REFUNDED already exist and v1 is running. What do you do in the next hour?",
          "a": "First check whether v1 crashes on those rows or just mishandles them. If it crashes (strict enum parsing), the fastest fix is a forward patch of v1 that maps unknown values to a safe fallback (e.g. treat as REFUNDED for display, block further state transitions) and logs them. Avoid rewriting the data unless the business agrees on semantics: converting to REFUNDED loses information. Pause the Kafka consumers that crash, and let them catch up once they tolerate the value."
        },
        {
          "q": "Design the release sequence for adding a new enum value so that any single step can be rolled back safely.",
          "a": "Step 1: deploy readers everywhere (API, consumers, analytics) that accept the value: unknown-tolerant parsing, and Avro or Protobuf schema updated with a default. Step 2: confirm all consumers run that version (consumer group client versions, deploy dashboard). Step 3: enable writing the value behind a feature flag, ramping slowly. Rollback of step 3 is a flag flip; rolling back step 1 is safe because nothing writes the value yet. Never ship writer and reader in the same release."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-14',
      difficulty: 'hard',
      question:
        'Select ALL that apply: a NestJS service takes 70–90 s to boot because it warms a large in-memory cache. Which probe configurations avoid CrashLoopBackOff without making real hangs undetectable?',
      options: [
        'A startupProbe with periodSeconds 10 and failureThreshold 12 (120 s budget), plus a normal liveness probe that only starts after startup succeeds.',
        'livenessProbe with initialDelaySeconds 120 and no startupProbe, accepting that hangs during the first 2 minutes of every pod life are undetected.',
        'Remove the liveness probe entirely and rely on readiness to restart hung pods.',
        'Keep liveness aggressive (period 5 s, threshold 2) but return 200 from the liveness endpoint during warm-up, while readiness reports not-ready until the cache is warm.',
      ],
      correct: [0, 3],
      explanation:
        'A startup probe is designed for this: generous boot budget, then normal liveness. Alternatively, a liveness endpoint that is purely process-local (answers during warm-up) plus a readiness gate on warm-up also works. A long initialDelaySeconds works but delays hang detection for every restart and is fragile if boot time grows — it is the legacy workaround. Readiness never restarts pods, so removing liveness leaves truly wedged pods alive forever.',
      followUps: [
        {
          "q": "Warm-up grows to 4 minutes as the cache grows. What problems does that cause beyond probes, and how do you fix the root cause?",
          "a": "Every rollout, scale-out and node drain now takes 4+ minutes per pod. HPA reacts far too slowly to spikes, deploys of 40 pods take an hour, and a crash-loop amplifies the outage. Fix the warm-up itself: load lazily with a smaller hot set, read a prebuilt snapshot from object storage (seconds instead of minutes), or move the cache to a shared store (Redis) so pods start cold but correct. A useful target is pods ready in under 30 s."
        },
        {
          "q": "During warm-up, the cache loads from the database. 40 pods restart at once after a node pool upgrade. What happens to the DB?",
          "a": "Forty pods each run the full warm-up query at once, a thundering herd on the DB: 40× the normal load for minutes, possibly slowing production traffic served by the pods still running. Mitigate: rate-limit the rollout (PDB `maxUnavailable: 1`, node pool upgrades with a small surge), add jitter to warm-up start, read warm-up data from a replica or a snapshot instead of the primary, and cap warm-up query concurrency per pod."
        }
      ],
    },
    {
      id: 'deployment-infra-mcq-15',
      difficulty: 'expert',
      question:
        'An HPA with `stabilizationWindowSeconds: 0` for scale-up and the default for scale-down is scaling a Kafka consumer on CPU. Consumer lag keeps growing during bursts even though CPU is only 40%. What is the best change?',
      code: {
        language: 'yaml',
        code: `metrics:
  - type: Resource
    resource:
      name: cpu
      target: { type: Utilization, averageUtilization: 70 }
# topic has 12 partitions; deployment currently at 6 replicas, max 30`,
      },
      options: [
        'Lower the CPU target to 30% so HPA scales earlier.',
        'Scale on consumer lag (e.g. KEDA Kafka scaler) with maxReplicas capped at 12, the partition count — the consumer is I/O-bound, and replicas beyond 12 would sit idle.',
        'Raise maxReplicas to 60 so the HPA has more room.',
        'Set scale-down stabilisation to 0 so pods cycle faster.',
      ],
      correct: [1],
      explanation:
        'An I/O-bound consumer can fall behind at low CPU, so lag (work waiting) is the right signal. A Kafka consumer group can have at most one active consumer per partition, so anything beyond 12 replicas idles — capping at 12 (or adding partitions) matters. Lowering the CPU target scales on the wrong signal and may still never trigger; more maxReplicas is useless beyond 12; faster scale-down causes rebalance storms that make lag worse.',
      followUps: [
        {
          "q": "Lag-based scaling now caps at 12 consumers, but lag still grows during bursts. What are your next levers?",
          "a": "All 12 partitions are consumed, so throughput per consumer is the limit. Options: increase per-consumer concurrency, processing messages in parallel within a partition while keeping per-key order (e.g. KafkaJS `partitionsConsumedConcurrently` or a keyed worker pool); batch downstream writes; or increase partitions (e.g. to 48). Note that adding partitions remaps keys to partitions, which breaks per-key ordering during the transition, so do it in a quiet window and ensure consumers tolerate brief reordering or drain first."
        },
        {
          "q": "Every scale event triggers a consumer-group rebalance. How do you keep that from making lag worse?",
          "a": "Classic eager rebalancing stops all consumers while partitions are reassigned, so frequent scaling causes repeated pauses. Use cooperative incremental rebalancing (only moved partitions pause), static group membership (`group.instance.id`) so restarts within the session timeout don't trigger rebalances, and HPA or KEDA behaviour policies with a scale-down stabilisation of ~5 minutes and step limits. Also commit offsets on partition revocation so the new owner doesn't reprocess a big chunk."
        }
      ],
    },
  ],
};

export default topic;
