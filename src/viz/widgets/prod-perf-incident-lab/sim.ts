// Incident simulator for "Incidents I: Slowness & Data-Layer Pain" (prod-performance).
// Four incidents from the topic, each a small queueing model (see kit/queue.ts):
//   index     – Incident 1: a query without an index turns into a seq scan as the table grows
//   pool      – Incident 3: an HTTP call inside a transaction holds pool connections
//   nplus1    – Incident 4: a GraphQL field resolves one query per item
//   eventloop – Incident 9: synchronous CPU work blocks the Node event loop → liveness restart spiral
// A timeline of 30 one-minute ticks: healthy, the trigger at TRIGGER, the learner's chosen
// mitigations go live at FIX_AT. All numbers are deterministic.
import type { BaseFrame } from '../../core';
import { fmtMs, fmtNum, fmtPct, metricsFor, station, waitQuantile, type Metrics, type RequestClass, type StationResult } from './kit/queue';

export const TICKS = 30;
export const TRIGGER = 5;
export const FIX_AT = 15;
export const SLO_MS = 300;

export type IncidentId = 'index' | 'pool' | 'nplus1' | 'eventloop';

export interface Params {
  incident: IncidentId;
  fixes: string[];
  knob: number;
}

export interface Gauge {
  label: string;
  value: string;
  /** 0..1+ how saturated this resource is (drives the tile colour) */
  level: number;
  sub?: string;
}

export interface TickModel {
  m: Metrics;
  /** the station that limits throughput */
  bottleneck: StationResult;
  gauges: Gauge[];
  /** one sentence about what the on-call would see, with numbers */
  says: string;
}

export interface Frame extends BaseFrame {
  tick: number;
  phase: 'healthy' | 'incident' | 'mitigated';
  p50: number[];
  p99: number[];
  err: number[];
  rps: number[];
  gauges: Gauge[];
  /** which mitigations are live at this tick */
  live: string[];
}

export interface FixDef {
  id: string;
  label: string;
  /** why it works (or does not), shown when it goes live; may use the model at FIX_AT */
  why: (k: number, after: TickModel) => string;
}

export interface Incident {
  id: IncidentId;
  label: string;
  section: string;
  summary: (k: number) => string;
  trigger: (k: number) => string;
  knob: { label: string; min: number; max: number; step: number; def: number; unit: (v: number) => string };
  fixes: FixDef[];
  model: (t: number, live: Set<string>, k: number, state: { pods: number; restarting: number[] }) => TickModel;
}

const ramp = (t: number, over: number) => Math.max(0, Math.min(1, (t - TRIGGER + 1) / over));

// ---------------------------------------------------------------- Incident 1: missing index
const DB_CORES = 16;
const OTHER_RPS = 2000;
const OTHER_MS = 1;
const SCAN_MAX = 40;
const INDEXED_MS = 0.5;

function indexModel(t: number, live: Set<string>, k: number): TickModel {
  const scan = t < TRIGGER ? 2 : 2 + (SCAN_MAX - 2) * ramp(t, 6);
  const qMs = live.has('index') ? INDEXED_MS : scan;
  const hit = live.has('cache') ? 0.9 : 0;
  const lamQ = k * (1 - hit);
  const lam = lamQ + OTHER_RPS;
  const db = station({ lambda: lam, servers: DB_CORES, svcMs: (lamQ * qMs + OTHER_RPS * OTHER_MS) / lam, timeoutMs: 5000 });
  const app = 6; // API pods ('pods' fix) add no DB capacity, so they do not appear in the model
  const classes: RequestClass[] = [
    { share: k * (1 - hit), baseMs: app + qMs, stations: [db] },
    { share: k * hit, baseMs: app + 1, stations: [] },
    { share: OTHER_RPS, baseMs: app + OTHER_MS, stations: [db] },
  ];
  const m = metricsFor(k + OTHER_RPS, classes);
  return {
    m,
    bottleneck: db,
    gauges: [
      { label: 'DB CPU', value: fmtPct(Math.min(1, db.rho)), level: db.rho, sub: `${fmtNum(db.offered)} of ${DB_CORES} cores wanted` },
      { label: 'top query mean', value: fmtMs(qMs), level: qMs / 20, sub: live.has('index') ? 'Index Scan' : t < TRIGGER ? 'small table' : 'Seq Scan' },
    ],
    says: `pg_stat_statements: the customer-orders query now averages ${fmtMs(qMs)} at ${fmtNum(lamQ)}/s, which is ${fmtNum(lamQ * qMs / 1000)} cores of CPU on its own. DB CPU ${fmtPct(Math.min(1, db.rho))}${db.overloaded ? ' and queries queue for a core' : ''}.`,
  };
}

// ---------------------------------------------------------------- Incident 3: app pool exhausted
const POOL = 10;
const POD_RPS = 500;
const Q_PER_REQ = 3;
const Q_MS = 4;

function poolModel(t: number, live: Set<string>, k: number): TickModel {
  const httpInTx = t >= TRIGGER && !live.has('outbox');
  const hold = Q_PER_REQ * Q_MS + (httpInTx ? k : 0);
  const size = live.has('poolsize') ? 30 : POOL;
  const timeoutMs = live.has('failfast') ? 2000 : 10_000; // default connectionTimeoutMillis 0 = wait until the gateway gives up
  const pool = station({ lambda: POD_RPS, servers: size, svcMs: hold, timeoutMs });
  // with the outbox the request only writes an outbox row; a relay makes the HTTP call later
  const base = 8 + Q_PER_REQ * Q_MS + (httpInTx ? k : 0);
  const m = metricsFor(POD_RPS, [{ share: 1, baseMs: base, stations: [pool] }]);
  const waiting = Math.round(pool.queued);
  return {
    m,
    bottleneck: pool,
    gauges: [
      { label: 'pool in use', value: `${Math.round(Math.min(size, pool.busy))}/${size}`, level: pool.rho, sub: `${waiting > 999 ? fmtNum(waiting) : waiting} waiting` },
      { label: 'DB CPU', value: '24%', level: 0.24, sub: 'the DB is fine' },
    ],
    says: `Little's law: ${POD_RPS} req/s × ${fmtMs(hold)} held per request = ${fmtNum(pool.offered)} connections needed; the pool has ${size}. ${pool.overloaded ? `About ${waiting > 999 ? fmtNum(waiting) : waiting} requests wait inside the pod while DB CPU sits at 24%.` : 'Requests rarely wait for a connection.'}`,
  };
}

// ---------------------------------------------------------------- Incident 4: N+1
const PAGE_RPS = 200;
const PODS_N1 = 4;
const RT_MS = 4; // one round trip per query, app ↔ pg

function nplus1Model(t: number, live: Set<string>, k: number): TickModel {
  const items = live.has('cap') ? Math.min(k, 20) : k;
  const queries = t < TRIGGER ? 1 : live.has('dataloader') ? 2 : 1 + items;
  const slots = (live.has('pods') ? PODS_N1 * 2 : PODS_N1) * 10;
  const pool = station({ lambda: PAGE_RPS * queries, servers: slots, svcMs: RT_MS, timeoutMs: 10_000 });
  // every query waits for a connection: n visits → n × mean wait, plus one unlucky tail wait
  const meanWait = pool.overloaded ? pool.timeoutMs * 0.75 : pool.pWait / pool.decay;
  const extra = Math.min(10_000, Math.max(0, queries - 1) * meanWait);
  const m = metricsFor(PAGE_RPS, [{ share: 1, baseMs: 10 + queries * RT_MS + extra, stations: [pool], capMs: 10_000 }]);
  return {
    m,
    bottleneck: pool,
    gauges: [
      { label: 'queries / request', value: String(queries), level: queries / 40, sub: `DB ${fmtNum(PAGE_RPS * queries)} QPS` },
      { label: 'pool in use', value: `${Math.round(Math.min(slots, pool.busy))}/${slots}`, level: pool.rho, sub: `${PODS_N1 * (live.has('pods') ? 2 : 1)} pods × 10` },
    ],
    says: `A trace shows a comb of ${queries} identical spans per page: ${queries} × ${RT_MS} ms round trips = ${fmtMs(queries * RT_MS)} before any queueing. DB QPS is ${fmtNum(PAGE_RPS * queries)} with no traffic increase, and the pool is ${fmtPct(Math.min(1, pool.rho))} busy.`,
  };
}

// ---------------------------------------------------------------- Incident 9: event loop blocked
const EL_PODS = 6;
const EL_RPS = 600;
const LIGHT_MS = 2;
const HEAVY_MS = 120;
const PROBE_LIMIT = 1000; // liveness timeout: a probe that waits longer than this fails

function eventloopModel(t: number, live: Set<string>, k: number, state: { pods: number; restarting: number[] }): TickModel {
  const target = live.has('replicas') ? 9 : EL_PODS;
  // pods that finished restarting come back
  state.restarting = state.restarting.filter((until) => until > t);
  state.pods = Math.max(0, target - state.restarting.length);
  const heavy = t < TRIGGER ? 0 : k / 100;
  const loopHeavy = live.has('worker') ? 3 : HEAVY_MS; // with a worker pool only serialisation stays on the loop
  const up = Math.max(1, state.pods);
  const perPod = EL_RPS / up;
  const loop = station({ lambda: perPod, servers: 1, svcMs: (1 - heavy) * LIGHT_MS + heavy * loopHeavy, timeoutMs: 10_000 });
  const classes: RequestClass[] = [
    { share: 1 - heavy, baseMs: 4 + LIGHT_MS, stations: [loop] },
    { share: heavy, baseMs: 4 + HEAVY_MS, stations: [loop] },
  ];
  const m = metricsFor(EL_RPS, classes);
  const lag = waitQuantile(loop, 0.99);
  // liveness: when probes queue behind the blocked loop for > 1 s, kubelet restarts the pod
  // (one at a time per tick here); a restarted pod is gone for 2 ticks, so peers get its traffic.
  if (!live.has('liveness') && lag > PROBE_LIMIT && state.pods > 1) state.restarting.push(t + 3);
  return {
    m,
    bottleneck: loop,
    gauges: [
      { label: 'event-loop lag p99', value: fmtMs(lag), level: lag / 200, sub: `loop busy ${fmtPct(Math.min(1, loop.rho))}` },
      { label: 'pods ready', value: `${state.pods}/${target}`, level: state.pods < target ? 1 : 0, sub: `${fmtNum(perPod)} req/s each` },
    ],
    says: `Each pod's single event loop is ${fmtPct(Math.min(1, loop.rho))} busy: ${fmtPct(heavy)} of requests run ${loopHeavy} ms of synchronous work on it, so every request, including /health, queues behind them (loop lag p99 ${fmtMs(lag)}). Pod CPU shows ~1 core: "CPU isn't high" is the trap.`,
  };
}

export const INCIDENTS: Record<IncidentId, Incident> = {
  index: {
    id: 'index',
    label: 'DB CPU pegged (missing index)',
    section: 'Incident 1',
    summary: (k) =>
      `Incident 1. Postgres has ${DB_CORES} cores and serves ${fmtNum(OTHER_RPS)} cheap queries/s plus ${k}/s of a customer-orders query that shipped days ago without an index. Nothing will be deployed today; the table just keeps growing.`,
    trigger: () => `minute ${TRIGGER}: the orders table crosses the size where the seq scan stops being cheap. Mean time of that query starts climbing from 2 ms.`,
    knob: { label: 'Rate of the unindexed query', min: 100, max: 800, step: 50, def: 500, unit: (v) => `${v}/s` },
    fixes: [
      {
        id: 'index',
        label: 'CREATE INDEX CONCURRENTLY',
        why: (k) => `The index turns a ${SCAN_MAX} ms seq scan into a ${INDEXED_MS} ms index scan: the query now needs ${fmtNum((k * INDEXED_MS) / 1000)} cores instead of ${fmtNum((k * SCAN_MAX) / 1000)}. CONCURRENTLY means writes were never blocked while it built.`,
      },
      {
        id: 'cache',
        label: 'Cache the result (90% hit)',
        why: (k) => `Only 1 in 10 lookups reaches Postgres, so the scan's CPU drops from ${fmtNum((k * SCAN_MAX) / 1000)} to ${fmtNum((k * 0.1 * SCAN_MAX) / 1000)} cores. The misses still pay the full ${SCAN_MAX} ms scan, so it buys headroom rather than fixing the query.`,
      },
      {
        id: 'pods',
        label: 'Scale API pods ×2',
        why: () => `More API pods add no database CPU: they just send the same scans faster. Scale the bottleneck, not the boxes in front of it.`,
      },
    ],
    model: (t, live, k) => indexModel(t, live, k),
  },
  pool: {
    id: 'pool',
    label: 'App pool exhausted (DB fine)',
    section: 'Incident 3',
    summary: () =>
      `Incident 3. One pod: ${POD_RPS} req/s, each doing ${Q_PER_REQ} queries × ${Q_MS} ms, so Little's law says ${(POD_RPS * Q_PER_REQ * Q_MS) / 1000} connections are busy on average. The pg pool has max ${POOL}, with connectionTimeoutMillis at its default of 0 (wait forever).`,
    trigger: (k) => `minute ${TRIGGER}: a deploy moves the payment-provider call (${k} ms) inside the order transaction. The connection is now held for the whole HTTP call.`,
    knob: { label: 'HTTP call held inside the transaction', min: 20, max: 400, step: 10, def: 150, unit: (v) => `${v} ms` },
    fixes: [
      {
        id: 'outbox',
        label: 'Outbox: HTTP call after commit',
        why: (k) => `The connection is held for ${Q_PER_REQ * Q_MS} ms again, not ${Q_PER_REQ * Q_MS + k} ms: ${(POD_RPS * Q_PER_REQ * Q_MS) / 1000} connections needed, the pool has ${POOL}. The order and an outbox row commit together; a relay makes the ${k} ms call afterwards, so the request neither waits on it nor holds a connection for it.`,
      },
      {
        id: 'poolsize',
        label: 'Raise pool max 10 → 30',
        why: (k) => `Little's law needs ${fmtNum((POD_RPS * (Q_PER_REQ * Q_MS + k)) / 1000)} connections while the HTTP call is inside the transaction${(POD_RPS * (Q_PER_REQ * Q_MS + k)) / 1000 > 30 ? ', so 30 is still not enough' : ', so 30 covers it this time'}, and every pod × pool must still fit under the DB's max_connections. A bigger pool treats the symptom, not the hold time.`,
      },
      {
        id: 'failfast',
        label: 'connectionTimeoutMillis = 2 s',
        why: () => `Requests that cannot get a connection now fail after 2 s instead of hanging until the 10 s gateway timeout. p99 is capped, but it does not shorten the hold time, so errors stay about the same.`,
      },
    ],
    model: (t, live, k) => poolModel(t, live, k),
  },
  nplus1: {
    id: 'nplus1',
    label: 'Too many queries (N+1)',
    section: 'Incident 4',
    summary: (k) =>
      `Incident 4. The orders page serves ${PAGE_RPS} req/s from ${PODS_N1} pods with a pool of 10 each (${PODS_N1 * 10} connections). Each query is cheap (~0.1 ms in Postgres) but costs a ${RT_MS} ms round trip. Page size is ${k} orders.`,
    trigger: (k) => `minute ${TRIGGER}: a new GraphQL field Order.customer ships. Its resolver runs one SELECT … WHERE id = $1 per order: 1 + ${k} queries per page.`,
    knob: { label: 'Page size', min: 10, max: 100, step: 5, def: 50, unit: (v) => `${v} items` },
    fixes: [
      {
        id: 'dataloader',
        label: 'Per-request DataLoader',
        why: (k) => `DataLoader collects the ${k} customer ids during one tick and issues one WHERE id = ANY($1): 2 queries per page instead of ${k + 1}. Latency no longer grows with page size.`,
      },
      {
        id: 'cap',
        label: 'Cap page size at 20 (fix now)',
        why: (k) => `${k > 20 ? `Fewer items means ${21} queries instead of ${k + 1}` : 'The page is already at most 20 items, so nothing changes'}. A fine stop-gap, but latency is still linear in page size; it comes back the day someone raises the cap.`,
      },
      {
        id: 'pods',
        label: 'Double the pods (80 connections)',
        why: () => `More connections absorb the extra queries, so queueing drops, but every page still makes the same round trips one after another. You pay for twice the pods to keep a bug.`,
      },
    ],
    model: (t, live, k) => nplus1Model(t, live, k),
  },
  eventloop: {
    id: 'eventloop',
    label: 'Event loop blocked (Node)',
    section: 'Incident 9',
    summary: (k) =>
      `Incident 9. ${EL_PODS} Node pods share ${EL_RPS} req/s. Normal requests need ${LIGHT_MS} ms of CPU on the event loop. Liveness probes fail after ${PROBE_LIMIT / 1000} s. ${k}% of requests will be a report export that does a ${HEAVY_MS} ms synchronous JSON.stringify on the main thread.`,
    trigger: (k) => `minute ${TRIGGER}: the export endpoint goes live; ${k}% of requests now block the loop for ${HEAVY_MS} ms each.`,
    knob: { label: 'Share of blocking requests', min: 1, max: 10, step: 1, def: 7, unit: (v) => `${v}%` },
    fixes: [
      {
        id: 'worker',
        label: 'Move it to worker_threads (Piscina)',
        why: () => `The ${HEAVY_MS} ms of CPU runs on a worker thread; the loop only does ~3 ms of hand-off. The export is still slow for its caller, but no one else waits behind it.`,
      },
      {
        id: 'liveness',
        label: 'Tolerant liveness (readiness drains)',
        why: () => `Busy pods are no longer killed. That stops the restart spiral (fewer pods → more load each → more failed probes), but each loop is still blocked, so latency stays high.`,
      },
      {
        id: 'replicas',
        label: 'Scale 6 → 9 pods',
        why: () => `Each loop gets ⅔ of the traffic, so it is less busy. It helps, but each blocked request still freezes its pod for ${HEAVY_MS} ms.`,
      },
    ],
    model: (t, live, k, s) => eventloopModel(t, live, k, s),
  },
};

export const INCIDENT_IDS = Object.keys(INCIDENTS) as IncidentId[];

export function simulate({ incident, fixes, knob }: Params): Frame[] {
  const inc = INCIDENTS[incident];
  const state = { pods: EL_PODS, restarting: [] as number[] };
  const chosen = inc.fixes.filter((f) => fixes.includes(f.id));
  const frames: Frame[] = [];
  const p50: number[] = [];
  const p99: number[] = [];
  const err: number[] = [];
  const rps: number[] = [];
  const first = inc.model(0, new Set(), knob, { pods: EL_PODS, restarting: [] });
  frames.push({
    tick: -1,
    phase: 'healthy',
    p50: [],
    p99: [],
    err: [],
    rps: [],
    gauges: first.gauges,
    live: [],
    caption: `${inc.summary(knob)} ${chosen.length ? `Your mitigations (${chosen.map((f) => f.label).join(', ')}) go live at minute ${FIX_AT}.` : `Pick mitigations above; they go live at minute ${FIX_AT}.`}`,
  });
  let before: TickModel | undefined;
  for (let t = 0; t < TICKS; t++) {
    const live = new Set(t >= FIX_AT ? chosen.map((f) => f.id) : []);
    const r = inc.model(t, live, knob, state);
    p50.push(r.m.p50);
    p99.push(r.m.p99);
    err.push(r.m.errRate);
    rps.push(r.m.rps);
    const phase: Frame['phase'] = t < TRIGGER ? 'healthy' : t >= FIX_AT && chosen.length ? 'mitigated' : 'incident';
    const nums = `p50 ${fmtMs(r.m.p50)}, p99 ${fmtMs(r.m.p99)}, errors ${fmtPct(r.m.errRate)}.`;
    let caption: string;
    let predict: string | undefined;
    if (t < TRIGGER) caption = `minute ${t}: healthy. ${nums} The busiest resource is ${fmtPct(Math.min(1, r.bottleneck.rho))} utilised.`;
    else if (t === TRIGGER) caption = `${inc.trigger(knob)} ${nums}`;
    else if (t < FIX_AT) caption = `minute ${t}: ${r.says} ${nums}`;
    else if (t === FIX_AT) {
      caption = chosen.length
        ? `minute ${t}: mitigation live. ${chosen.map((f) => f.why(knob, r)).join(' ')} Now ${nums}`
        : `minute ${t}: no mitigation was chosen, so nothing changes: ${nums} Toggle a fix above to replay the incident with it.`;
    } else caption = `minute ${t}: ${r.says} ${nums}`;
    if (t === FIX_AT - 1) {
      before = r;
      predict = chosen.length
        ? `Next minute ${chosen.map((f) => f.label).join(' + ')} go${chosen.length === 1 ? 'es' : ''} live. Will p99 get back under the ${SLO_MS} ms SLO?`
        : `No mitigation is selected. Which of the options above attacks the saturated resource rather than its symptoms?`;
    }
    if (t === TICKS - 1 && before) {
      const ok = r.m.p99 <= SLO_MS && r.m.errRate < 0.01;
      caption += ` Summary: p99 ${fmtMs(before.m.p99)} → ${fmtMs(r.m.p99)}, errors ${fmtPct(before.m.errRate)} → ${fmtPct(r.m.errRate)}. ${
        ok ? 'Back inside the SLO.' : chosen.length ? 'Still outside the SLO: the chosen fixes did not remove the saturation.' : 'Still burning the error budget.'
      }`;
    }
    frames.push({ tick: t, phase, p50: [...p50], p99: [...p99], err: [...err], rps: [...rps], gauges: r.gauges, live: [...live], caption, predict });
  }
  return frames;
}
