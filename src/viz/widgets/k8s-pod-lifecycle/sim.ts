// Pure, deterministic Kubernetes pod-lifecycle and autoscaling scenarios (no React, Node-testable).
// Semantics follow the Kubernetes docs:
//  - Pod phase Pending covers both waiting for scheduling and pulling images (ContainerCreating);
//    Running = bound to a node with containers created.
//  - A failing readiness probe removes the pod from Service endpoints; a failing liveness probe
//    (failureThreshold consecutive failures) makes the kubelet kill and restart the container.
//  - Restarts use exponential back-off 10s, 20s, 40s … capped at 300s (CrashLoopBackOff), reset
//    after 10 minutes of running fine. A container over its memory limit is OOMKilled (exit 137);
//    a container over its CPU limit is only throttled.
//  - HPA: desiredReplicas = ceil(currentReplicas × currentUtilization / targetUtilization), every 15s,
//    tolerance 0.1, scale-up ≤ max(+100%, +4 pods) per 15s, scale-down stabilisation window 300s.
//    When scaling up, not-yet-ready pods are assumed to use 0% (dampening).
//  - Pods that fit on no node stay Pending (Unschedulable); the Cluster Autoscaler adds a node.
import type { BaseFrame } from '../../core';

export type Scenario = 'rollout' | 'crashloop' | 'oom' | 'scaleup';

export interface Params {
  scenario: Scenario;
  /** seconds the app needs before its readiness probe passes (rollout) */
  startup: number;
  /** liveness probe failureThreshold (crash loop) */
  failureThreshold: number;
  /** HPA target CPU utilisation, % of requests (scale-up) */
  target: number;
}

export const DEFAULT_PARAMS: Params = { scenario: 'rollout', startup: 10, failureThreshold: 3, target: 60 };

export type Status = 'Pending' | 'ContainerCreating' | 'Running' | 'CrashLoopBackOff' | 'OOMKilled' | 'Terminating';

export interface PodView {
  name: string;
  node: string | null;
  /** pod phase (API) */
  phase: 'Pending' | 'Running';
  /** what `kubectl get pods` STATUS shows */
  status: Status;
  ready: boolean;
  restarts: number;
  note?: string;
  tone?: 'good' | 'bad' | 'warn' | 'accent';
}

export interface NodeView {
  name: string;
  slots: number;
  state: 'ready' | 'provisioning';
}

export interface HpaView {
  load: number; // total CPU demand, millicores
  util: number; // average utilisation of ready pods, % of request
  target: number;
  current: number;
  desired: number;
  formula: string;
  hist: { t: number; replicas: number; util: number }[];
}

export interface Frame extends BaseFrame {
  t: number;
  nodes: NodeView[];
  pods: PodView[];
  /** pods currently receiving traffic from the Service */
  endpoints: string[];
  /** restart back-off delays so far (crash loop / OOM) */
  backoffs: number[];
  /** memory samples for the OOM scenario */
  mem?: { hist: { t: number; mib: number }[]; limit: number; request: number };
  hpa?: HpaView;
}

export const BACKOFF_BASE = 10;
export const BACKOFF_CAP = 300;
export const backoff = (n: number) => Math.min(BACKOFF_CAP, BACKOFF_BASE * 2 ** n);
export const POD_REQUEST_M = 500;
export const POD_LIMIT_M = 1000;
export const TOLERANCE = 0.1;
export const SYNC = 15;
export const STABILIZATION = 300;
export const SLOTS_PER_NODE = 3;
export const MIN_REPLICAS = 2;
export const MAX_REPLICAS = 10;

const clonePods = (ps: PodView[]) => ps.map((p) => ({ ...p }));
const ep = (ps: PodView[]) => ps.filter((p) => p.ready).map((p) => p.name);
const fmtT = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m${s % 60 ? `${String(s % 60).padStart(2, '0')}s` : ''}` : `${s}s`);

export function simulate(p: Params): Frame[] {
  switch (p.scenario) {
    case 'rollout':
      return rollout(p);
    case 'crashloop':
      return crashloop(p);
    case 'oom':
      return oom();
    default:
      return scaleup(p);
  }
}

// ---------------------------------------------------------------- rolling update
function rollout({ startup }: Params): Frame[] {
  const PERIOD = 5; // readiness periodSeconds
  const PULL = 6;
  const readyAfter = Math.ceil(startup / PERIOD) * PERIOD; // first passing probe after the app is up
  const frames: Frame[] = [];
  const nodes: NodeView[] = [
    { name: 'node-1', slots: SLOTS_PER_NODE, state: 'ready' },
    { name: 'node-2', slots: SLOTS_PER_NODE, state: 'ready' },
  ];
  const pods: PodView[] = [
    { name: 'web-v1-a', node: 'node-1', phase: 'Running', status: 'Running', ready: true, restarts: 0 },
    { name: 'web-v1-b', node: 'node-2', phase: 'Running', status: 'Running', ready: true, restarts: 0 },
    { name: 'web-v1-c', node: 'node-1', phase: 'Running', status: 'Running', ready: true, restarts: 0 },
  ];
  const push = (t: number, caption: string, predict?: string) => {
    frames.push({ t, nodes: nodes.map((n) => ({ ...n })), pods: clonePods(pods), endpoints: ep(pods), backoffs: [], caption, predict });
    pods.forEach((x) => delete x.tone);
  };
  push(
    0,
    `Deployment "web" runs 3 v1 pods behind a Service. kubectl apply a v2 image with strategy RollingUpdate, maxSurge 1, maxUnavailable 0: at most 4 pods, never fewer than 3 ready. v2 needs ${startup}s to start; readiness is probed every ${PERIOD}s.`,
  );
  let t = 0;
  const targets = ['node-2', 'node-1', 'node-2'];
  ['a', 'b', 'c'].forEach((sfx, i) => {
    const name = `web-v2-${sfx}`;
    const pod: PodView = { name, node: null, phase: 'Pending', status: 'Pending', ready: false, restarts: 0, tone: 'accent', note: 'unscheduled' };
    pods.push(pod);
    push(
      t,
      `t=${t}s: ReplicaSet v2 creates ${name} (surge pod #${pods.length}). Phase Pending: the scheduler is picking a node with enough free CPU/memory requests.`,
    );
    t += 1;
    pod.node = targets[i];
    pod.status = 'ContainerCreating';
    pod.note = 'pulling image';
    pod.tone = 'warn';
    push(t, `t=${t}s: bound to ${targets[i]}. Still phase Pending, status ContainerCreating: the kubelet pulls the image and sets up volumes and networking (~${PULL}s).`);
    t += PULL;
    pod.phase = 'Running';
    pod.status = 'Running';
    pod.note = 'readiness failing';
    pod.tone = 'warn';
    push(
      t,
      `t=${t}s: container started, phase Running, but READY 0/1: readiness probes fail while the app warms up, so the pod is NOT in the Service endpoints and gets no traffic.`,
      i === 0 ? `${name} is Running. Will the Service send it user requests yet, and will v1 pods start terminating?` : undefined,
    );
    t += readyAfter;
    pod.ready = true;
    pod.note = 'ready';
    pod.tone = 'good';
    const old = pods.find((x) => x.name === `web-v1-${sfx}`)!;
    old.status = 'Terminating';
    old.ready = false;
    old.tone = 'bad';
    old.note = 'SIGTERM, draining';
    push(
      t,
      `t=${t}s: readiness probe passes → ${name} joins the endpoints and takes traffic. Only now is ${old.name} removed from endpoints and sent SIGTERM (Terminating), so ready pods never drop below 3.`,
      i === 0 ? 'One v2 pod is ready and one v1 pod is draining. What does the Deployment controller do next?' : undefined,
    );
    pods.splice(pods.indexOf(old), 1);
  });
  t += 3;
  push(
    t,
    `t=${t}s: rollout complete: 3/3 v2 pods ready, 0 downtime. Each step cost ${1 + PULL + readyAfter}s (schedule 1s + pull ${PULL}s + readiness ${readyAfter}s), so a slow-starting app makes the whole rollout slower, never unsafe.`,
  );
  return frames;
}

// ---------------------------------------------------------------- liveness → CrashLoopBackOff
function crashloop({ failureThreshold: F }: Params): Frame[] {
  const PERIOD = 10; // liveness periodSeconds
  const frames: Frame[] = [];
  const nodes: NodeView[] = [
    { name: 'node-1', slots: SLOTS_PER_NODE, state: 'ready' },
    { name: 'node-2', slots: SLOTS_PER_NODE, state: 'ready' },
  ];
  const a: PodView = { name: 'api-7f9-a', node: 'node-1', phase: 'Running', status: 'Running', ready: true, restarts: 0 };
  const b: PodView = { name: 'api-7f9-b', node: 'node-2', phase: 'Running', status: 'Running', ready: true, restarts: 0 };
  const pods = [a, b];
  const backoffs: number[] = [];
  const push = (t: number, caption: string, predict?: string) => {
    frames.push({ t, nodes: nodes.map((n) => ({ ...n })), pods: clonePods(pods), endpoints: ep(pods), backoffs: [...backoffs], caption, predict });
    pods.forEach((x) => delete x.tone);
  };
  push(
    0,
    `Two api pods, both Running and READY 1/1 behind the Service. Liveness probe: every ${PERIOD}s, failureThreshold ${F}. Readiness probe: every 5s, failureThreshold 1.`,
  );
  let t = 20;
  a.ready = false;
  a.note = 'hung: probes time out';
  a.tone = 'warn';
  push(
    t,
    `t=${t}s: api-7f9-a deadlocks reading a corrupt file on its emptyDir volume. Its readiness probe fails at once, so it leaves the endpoints: all traffic goes to api-7f9-b. The process is still alive.`,
    `Readiness already pulled it out of rotation. What will the liveness probe do, and how long until it acts (period ${PERIOD}s × threshold ${F})?`,
  );
  t += PERIOD * F;
  for (let n = 0; n < 6; n++) {
    a.status = 'CrashLoopBackOff';
    a.note = `back-off ${backoff(n)}s`;
    a.tone = 'bad';
    a.restarts = n;
    backoffs.push(backoff(n));
    push(
      t,
      n === 0
        ? `t=${fmtT(t)}: liveness failed ${F}× in a row, so the kubelet kills the container (SIGTERM, then SIGKILL after the grace period). The POD stays on node-1; only the container restarts, after a ${backoff(0)}s back-off. Status: CrashLoopBackOff.`
        : `t=${fmtT(t)}: liveness failed ${F}× again → killed. Restart #${n + 1} waits ${backoff(n)}s${backoff(n) === BACKOFF_CAP ? ' (capped at 5 minutes)' : ` (doubled from ${backoff(n - 1)}s)`}. RESTARTS ${n}.`,
      n === 0 ? `The container restarts in ${backoff(0)}s. The corrupt file lives on an emptyDir volume, which survives container restarts. What happens next?` : backoff(n + 1) === BACKOFF_CAP && backoff(n) < BACKOFF_CAP ? `The delay has doubled to ${backoff(n)}s. What will the next back-off be?` : undefined,
    );
    t += backoff(n);
    a.status = 'Running';
    a.restarts = n + 1;
    a.note = 'started, hangs again';
    a.tone = 'warn';
    if (n < 2 || n === 5)
      push(
        t,
        `t=${fmtT(t)}: restart #${n + 1}: the container starts, READY 0/1, hits the same corrupt file and hangs. ${n === 5 ? 'Restarts now stay 5 minutes apart forever: the kubelet will not fix this for you.' : 'Still no traffic, the Service only uses api-7f9-b.'}`,
      );
    t += PERIOD * F;
  }
  push(
    t,
    `Total: ${a.restarts} restarts, back-offs ${backoffs.join('s, ')}s. Fix the cause (delete the pod so it gets a fresh emptyDir, or fix the bug); the back-off resets after 10 minutes of healthy running. A liveness probe that checks a dependency would have restarted the healthy pod too.`,
  );
  return frames;
}

// ---------------------------------------------------------------- OOMKilled
function oom(): Frame[] {
  const LIMIT = 512;
  const REQUEST = 256;
  const STEP = 15;
  const frames: Frame[] = [];
  const nodes: NodeView[] = [
    { name: 'node-1', slots: SLOTS_PER_NODE, state: 'ready' },
    { name: 'node-2', slots: SLOTS_PER_NODE, state: 'ready' },
  ];
  const a: PodView = { name: 'worker-5c-a', node: 'node-1', phase: 'Running', status: 'Running', ready: true, restarts: 0, note: '' };
  const b: PodView = { name: 'worker-5c-b', node: 'node-2', phase: 'Running', status: 'Running', ready: true, restarts: 0, note: '' };
  const pods = [a, b];
  const backoffs: number[] = [];
  const hist: { t: number; mib: number }[] = [];
  const push = (t: number, mib: number, caption: string, predict?: string) => {
    hist.push({ t, mib });
    frames.push({
      t,
      nodes: nodes.map((n) => ({ ...n })),
      pods: clonePods(pods),
      endpoints: ep(pods),
      backoffs: [...backoffs],
      mem: { hist: hist.map((h) => ({ ...h })), limit: LIMIT, request: REQUEST },
      caption,
      predict,
    });
    pods.forEach((x) => delete x.tone);
  };
  let t = 0;
  let mib = 160;
  a.note = `${mib}Mi`;
  push(
    t,
    mib,
    `worker-5c-a: memory request ${REQUEST}Mi (used for scheduling), limit ${LIMIT}Mi (enforced by the kernel cgroup). It leaks ~64Mi every ${STEP}s while processing a large batch.`,
  );
  const LEAK = 64;
  for (let cycle = 0; cycle < 3; cycle++) {
    while (mib + LEAK <= LIMIT) {
      t += STEP;
      mib += LEAK;
      a.note = `${mib}Mi`;
      a.tone = mib > REQUEST ? 'warn' : undefined;
      const nextOver = mib + LEAK > LIMIT;
      if (cycle === 0 || nextOver)
        push(
          t,
          mib,
          `t=${fmtT(t)}: ${mib}Mi used${mib > REQUEST ? `, above the ${REQUEST}Mi request (allowed: requests are not caps)` : ''}.${nextOver ? ` Next allocation would pass the ${LIMIT}Mi limit.` : ''}`,
          nextOver && cycle === 0 ? `The next ${LEAK}Mi allocation crosses the ${LIMIT}Mi limit. Will it be throttled like CPU, or something else?` : undefined,
        );
    }
    t += STEP;
    a.status = 'OOMKilled';
    a.ready = false;
    a.tone = 'bad';
    a.note = 'exit 137';
    backoffs.push(backoff(cycle));
    push(
      t,
      LIMIT,
      cycle === 0
        ? `t=${fmtT(t)}: the allocation exceeds ${LIMIT}Mi → the kernel OOM killer SIGKILLs the process: OOMKilled, exit code 137. Memory cannot be throttled, unlike CPU over its limit. It leaves the endpoints.`
        : `t=${fmtT(t)}: OOMKilled again (exit 137). Same input, same leak, same result.`,
    );
    a.status = 'CrashLoopBackOff';
    a.note = `back-off ${backoff(cycle)}s`;
    push(
      t + 1,
      0,
      `t=${fmtT(t + 1)}: status CrashLoopBackOff: the kubelet waits ${backoff(cycle)}s before restart #${cycle + 1}${cycle > 0 ? ` (doubled from ${backoff(cycle - 1)}s)` : ''}. kubectl describe shows Last State: Terminated, Reason: OOMKilled.`,
      cycle === 0 ? 'After the restart memory starts from scratch. Does the restart fix the problem?' : undefined,
    );
    t += 1 + backoff(cycle);
    mib = 160;
    a.status = 'Running';
    a.ready = true;
    a.restarts = cycle + 1;
    a.note = `${mib}Mi`;
    a.tone = 'accent';
    push(t, mib, `t=${fmtT(t)}: restart #${cycle + 1}: fresh process at ${mib}Mi, READY again, and it picks the same batch back up.`);
  }
  push(
    t,
    mib,
    `Pattern: OOMKilled → CrashLoopBackOff with back-offs ${backoffs.join('s, ')}s. Fix it by profiling the leak or raising the limit to the real peak (and set the request close to it), not by adding replicas: every replica would leak the same way.`,
  );
  return frames;
}

// ---------------------------------------------------------------- HPA + Cluster Autoscaler
interface SPod {
  name: string;
  node: string | null;
  readyAt: number; // time it becomes ready (Infinity until scheduled)
  createdAt: number;
}

function scaleup({ target }: Params): Frame[] {
  const frames: Frame[] = [];
  const nodes: NodeView[] = [
    { name: 'node-1', slots: SLOTS_PER_NODE, state: 'ready' },
    { name: 'node-2', slots: SLOTS_PER_NODE, state: 'ready' },
  ];
  const nodeReadyAt: Record<string, number> = {};
  const BASE_LOAD = Math.round((MIN_REPLICAS * POD_REQUEST_M * target) / 100);
  const PEAK = 2400;
  const DROP_AT = 165;
  const loadAt = (t: number) => (t < 15 ? BASE_LOAD : t < DROP_AT ? PEAK : 700);
  let seq = 0;
  const letters = 'abcdefghijklmnop';
  const pods: SPod[] = [];
  const mkPod = (t: number, ready: boolean): SPod => ({ name: `web-${letters[seq++]}`, node: null, readyAt: ready ? t : Infinity, createdAt: t });
  for (let i = 0; i < MIN_REPLICAS; i++) {
    const p = mkPod(0, true);
    p.node = nodes[i].name;
    pods.push(p);
  }
  let replicas = MIN_REPLICAS;
  const recs: { t: number; r: number }[] = []; // desired-replica recommendations (for stabilisation)
  const hist: HpaView['hist'] = [];
  let caRequested = false;
  let lastHighRec = 0;

  const schedule = (t: number) => {
    for (const p of pods)
      if (!p.node) {
        const n = nodes.find((nd) => nd.state === 'ready' && pods.filter((q) => q.node === nd.name).length < nd.slots);
        if (n) {
          p.node = n.name;
          p.readyAt = t + 15; // image pull + readiness ≈ one sync period
        }
      }
  };
  const view = (t: number, util: number, desired: number, formula: string, caption: string, predict?: string) => {
    hist.push({ t, replicas, util });
    const pv: PodView[] = pods.map((p) => {
      const ready = p.readyAt <= t;
      const status: Status = !p.node ? 'Pending' : ready ? 'Running' : 'ContainerCreating';
      return {
        name: p.name,
        node: p.node,
        phase: ready ? 'Running' : 'Pending',
        status,
        ready,
        restarts: 0,
        note: !p.node ? 'Unschedulable' : ready ? `${Math.round(util)}% CPU` : 'starting',
        tone: !p.node ? 'bad' : ready ? undefined : 'warn',
      };
    });
    frames.push({
      t,
      nodes: nodes.map((n) => ({ ...n })),
      pods: pv,
      endpoints: pv.filter((p) => p.ready).map((p) => p.name),
      backoffs: [],
      hpa: { load: loadAt(t), util, target, current: replicas, desired, formula, hist: hist.map((h) => ({ ...h })) },
      caption,
      predict,
    });
  };

  view(
    0,
    target,
    replicas,
    `ceil(${replicas} × ${target}/${target}) = ${replicas}`,
    `Deployment "web": each pod requests ${POD_REQUEST_M}m CPU (limit ${POD_LIMIT_M}m); a node fits ${SLOTS_PER_NODE} pods. HPA: target ${target}% CPU of requests, min ${MIN_REPLICAS}, max ${MAX_REPLICAS}, evaluated every ${SYNC}s. Steady load ${BASE_LOAD}m → ${target}% per pod.`,
    `Load is about to jump to ${PEAK}m. Using desired = ceil(current × util / target), roughly how many replicas will the HPA want?`,
  );

  let held = false;
  for (let t = SYNC; t <= 240; t += SYNC) {
    // cluster autoscaler: node becomes ready
    let caNote = '';
    const joined = nodes.filter((n) => n.state === 'provisioning' && t >= nodeReadyAt[n.name]);
    joined.forEach((n) => (n.state = 'ready'));
    if (joined.length) caNote = ` Cluster Autoscaler: ${joined.map((n) => n.name).join(', ')} joined the cluster; the scheduler places the Pending pods there.`;
    schedule(t - 1);
    const ready = pods.filter((p) => p.readyAt <= t);
    const notReady = pods.length - ready.length;
    const load = loadAt(t);
    const perPod = Math.min(POD_LIMIT_M, load / ready.length);
    const util = (perPod / POD_REQUEST_M) * 100;
    let ratio = util / target;
    let formula = `ceil(${ready.length} × ${Math.round(util)}/${target}) = ${Math.ceil(ready.length * ratio)}`;
    let desired: number;
    let damp = '';
    if (ratio > 1 + TOLERANCE && notReady > 0) {
      // not-yet-ready pods count as 0% when scaling up
      const adj = (ready.length * util) / (ready.length + notReady);
      ratio = adj / target;
      formula = `ceil(${ready.length + notReady} × ${Math.round(adj)}/${target}) = ${Math.ceil((ready.length + notReady) * ratio)}`;
      damp = ` ${notReady} not-ready pod${notReady > 1 ? 's count' : ' counts'} as 0%, damping the average to ${Math.round(adj)}%.`;
      desired = Math.abs(ratio - 1) <= TOLERANCE ? replicas : Math.ceil((ready.length + notReady) * ratio);
    } else desired = Math.abs(ratio - 1) <= TOLERANCE ? replicas : Math.ceil(ready.length * ratio);
    const within = Math.abs(ratio - 1) <= TOLERANCE;
    desired = Math.max(MIN_REPLICAS, Math.min(MAX_REPLICAS, desired));
    recs.push({ t, r: desired });
    if (desired >= replicas) lastHighRec = t;
    const prev = replicas;
    let caption = '';
    let predict: string | undefined;
    if (desired > replicas) {
      const cap = Math.max(replicas * 2, replicas + 4);
      const next = Math.min(desired, cap);
      for (let i = replicas; i < next; i++) pods.push(mkPod(t, false));
      replicas = next;
      schedule(t);
      const pending = pods.filter((p) => !p.node).length;
      caption = `t=${t}s: load ${load}m over ${ready.length} ready pod${ready.length > 1 ? 's' : ''} = ${Math.round(util)}% CPU${perPod >= POD_LIMIT_M ? ' (pods are pinned at their CPU limit, so the real demand is even higher)' : ''}.${damp} HPA: ${formula}${next < desired ? `, capped by the scale-up policy (max(+100%, +4 pods) per ${SYNC}s) at ${next}` : ''}: ${prev} → ${replicas} replicas.${
        pending ? ` ${pending} pod${pending > 1 ? 's' : ''} cannot fit on any node: Pending, reason Unschedulable (Insufficient cpu).` : ''
      }`;
      if (pending && !caRequested) predict = `${pending} pod${pending > 1 ? 's are' : ' is'} stuck Pending because every node is full. Will the HPA fix that, and what will?`;
    } else if (desired < replicas) {
      // scale-down stabilisation: use the highest recommendation of the last 300s
      const windowMax = Math.max(...recs.filter((r) => r.t > t - STABILIZATION).map((r) => r.r));
      if (windowMax >= replicas) {
        caption = `t=${t}s: load fell to ${load}m → ${Math.round(util)}% CPU. HPA computes ${formula}, but the ${STABILIZATION}s scale-down stabilisation window still remembers a recommendation of ${windowMax}, so replicas stay at ${replicas}.`;
        if (!held) predict = `The load stays low. When will the HPA actually remove pods, and why does it wait?`;
        held = true;
      } else {
        replicas = windowMax;
        caption = `t=${t}s: scale down to ${replicas}.`;
      }
    } else {
      const pendingNow = pods.filter((p) => !p.node).length;
      caption = `t=${t}s: ${Math.round(util)}% CPU across ${ready.length} ready pod${ready.length > 1 ? 's' : ''}. ${
        within ? `${damp}${damp ? ' ' : ''}Ratio ${ratio.toFixed(2)} is within the ±${TOLERANCE * 100}% tolerance: no change.`.trim() : `HPA: ${formula}, already the replica count (${replicas}).`
      }${pendingNow ? ` ${pendingNow} pod${pendingNow > 1 ? 's' : ''} still Pending while the new node boots: the HPA has done its part, capacity is the bottleneck.` : ''}`;
    }
    // cluster autoscaler reacts to unschedulable pods: enough new nodes for what is still pending
    const pendingPods = pods.filter((p) => !p.node).length;
    const incoming = nodes.filter((n) => n.state === 'provisioning').reduce((a, n) => a + n.slots, 0);
    if (pendingPods > incoming) {
      const add = Math.ceil((pendingPods - incoming) / SLOTS_PER_NODE);
      const names: string[] = [];
      for (let i = 0; i < add; i++) {
        const name = `node-${nodes.length + 1}`;
        nodes.push({ name, slots: SLOTS_PER_NODE, state: 'provisioning' });
        nodeReadyAt[name] = t + 75;
        names.push(name);
      }
      caRequested = true;
      caption += ` Cluster Autoscaler sees the unschedulable pods and asks the cloud for ${names.join(' + ')} (boots in ~75s).`;
    }
    const readyNow = pods.filter((p) => p.readyAt <= t).length;
    if (!caption.includes('ready') && readyNow > ready.length) caption += ` ${readyNow - ready.length} new pod(s) passed readiness.`;
    caption += caNote;
    view(t, util, desired, formula, caption, predict);
    if (held && t >= DROP_AT + 2 * SYNC) break;
  }

  // jump past the stabilisation window
  const tEnd = lastHighRec + STABILIZATION;
  const lowUtil = Math.min(POD_LIMIT_M, loadAt(tEnd) / replicas) / POD_REQUEST_M * 100;
  const want = Math.max(MIN_REPLICAS, Math.ceil((replicas * lowUtil) / target));
  const before = replicas;
  replicas = want;
  pods.splice(want);
  const finalUtil = (Math.min(POD_LIMIT_M, loadAt(tEnd) / replicas) / POD_REQUEST_M) * 100;
  view(
    tEnd,
    finalUtil,
    want,
    `ceil(${before} × ${Math.round(lowUtil)}/${target}) = ${want}`,
    `t=${fmtT(tEnd)}: ${STABILIZATION}s after the last high recommendation (t=${lastHighRec}s), every recommendation in the window is low, so the HPA scales ${before} → ${want} replicas (${Math.round(finalUtil)}% CPU each).${
      caRequested ? ' Later the Cluster Autoscaler drains and removes the underused node (after ~10 minutes unneeded).' : ''
    }`,
  );
  return frames;
}
