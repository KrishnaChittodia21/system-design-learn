// Hot-spot simulator for "Incidents II: Scale & Growth" (prod-scale).
// Load is spread over N nodes (API servers or DB shards); each node is an M/M/c queue
// (kit/queue.ts). Three incidents from the topic:
//   sticky     – §3: ip_hash + a carrier CGNAT pins a big share of users to one API node
//   celebrity  – §8: one viral key lands on one shard (reads or writes)
//   monotonic  – §8: range sharding on created_at sends every insert to the newest shard
// The learner's mitigations go live at FIX_AT. Deterministic, pure.
import type { BaseFrame } from '../../core';
import { fmtMs, fmtNum, fmtPct, metricsFor, station, type RequestClass, type StationResult } from '../prod-perf-incident-lab/kit/queue';

export const TICKS = 30;
export const TRIGGER = 5;
export const FIX_AT = 15;
export const SLO_MS = 200;

export type ScenarioId = 'sticky' | 'celebrity' | 'monotonic';
export type HotKind = 'reads' | 'writes';

export interface Params {
  scenario: ScenarioId;
  fixes: string[];
  knob: number;
  kind: HotKind;
}

export interface NodeLoad {
  name: string;
  /** requests per second arriving at this node */
  lambda: number;
  /** requests per second it can serve */
  capacity: number;
  rho: number;
  down?: boolean;
}

export interface Frame extends BaseFrame {
  tick: number;
  nodes: NodeLoad[];
  p50: number[];
  p99: number[];
  err: number[];
  rps: number;
  skew: number;
  live: string[];
}

interface Tick {
  nodes: { name: string; lambda: number; servers: number; svcMs: number; baseMs: number; down?: boolean }[];
  says: string;
}

export interface FixDef {
  id: string;
  label: string;
  why: (p: Params) => string;
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  nodeKind: string;
  summary: (p: Params) => string;
  trigger: (p: Params) => string;
  knob: { label: string; min: number; max: number; step: number; def: number; unit: (v: number) => string };
  hasKind?: boolean;
  fixes: FixDef[];
  model: (t: number, live: Set<string>, p: Params) => Tick;
}

const ramp = (t: number) => Math.max(0, Math.min(1, (t - TRIGGER + 1) / 3));

// ------------------------------------------------ §3 sticky sessions behind a CGNAT
const API_RPS = 900;
const API_WORKERS = 8;
const API_SVC = 25; // ms → 320 req/s per node

function stickyModel(t: number, live: Set<string>, p: Params): Tick {
  const n = live.has('addnodes') ? 6 : 4;
  const nat = 0.05 + (p.knob / 100 - 0.05) * ramp(t);
  const even = live.has('leastconn');
  // restarting the hot node: for one tick ip_hash re-maps its IPs to the next node, then they come back
  const restartTick = live.has('restart') && t === FIX_AT;
  const nodes = Array.from({ length: n }, (_, i) => {
    let share = even ? 1 / n : (1 - nat) / n + (i === 0 ? nat : 0);
    if (restartTick && !even) share = i === 0 ? 0 : (1 - nat) / (n - 1) + (i === 1 ? nat : 0);
    return { name: `api-${i + 1}`, lambda: API_RPS * share, servers: API_WORKERS, svcMs: API_SVC, baseMs: API_SVC + 5, down: restartTick && !even && i === 0 };
  });
  const hot = nodes.reduce((a, b) => (b.lambda > a.lambda ? b : a));
  return {
    nodes,
    says: even
      ? `least_conn spreads ${API_RPS} req/s evenly: ${fmtNum(API_RPS / n)} req/s per node. Sessions live in Redis, so any node can serve any user.`
      : `Per-node RPS tells the story: ${hot.name} gets ${fmtNum(hot.lambda)} req/s (one CGNAT IP = ${fmtPct(nat)} of users, all hashed to it) while its peers get ${fmtNum((API_RPS * (1 - nat)) / n)}. It is a distribution problem, not a capacity one.`,
  };
}

// ------------------------------------------------ §8 celebrity key on one shard
const SHARDS = 8;
const SHARD_CORES = 16;
const SHARD_MS = 2; // → 8,000 ops/s per shard
const BASE_OPS = 30_000;
const SALT = 16;

function celebrityModel(t: number, live: Set<string>, p: Params): Tick {
  const n = live.has('reshard') ? SHARDS * 2 : SHARDS;
  const hotOps = p.knob * ramp(t);
  const reads = p.kind === 'reads';
  let hotLeft = hotOps;
  if (reads && live.has('cache')) hotLeft *= 0.002; // 5 s TTL: ~1 miss per key per app node per 5 s
  const salted = live.has('salt');
  // salting: writes go to key#0..15 (spread over every shard); a read must fetch all 16 sub-keys
  const perShardHot = salted ? (hotLeft * (reads ? SALT : 1)) / n : 0;
  const nodes = Array.from({ length: n }, (_, i) => {
    const base = BASE_OPS / n;
    const lam = base + perShardHot + (!salted && i === 0 ? hotLeft : 0);
    const replicas = i === 0 && live.has('replicas') && reads ? 3 : 1; // primary + 2 read replicas
    return { name: `shard-${i + 1}`, lambda: lam, servers: SHARD_CORES * replicas, svcMs: SHARD_MS, baseMs: 3 + SHARD_MS };
  });
  const hot = nodes.reduce((a, b) => (b.lambda > a.lambda ? b : a));
  return {
    nodes,
    says: `${hot.name} takes ${fmtNum(hot.lambda)} ops/s against ~${fmtNum((SHARD_CORES * 1000) / SHARD_MS)} capacity; the median shard takes ${fmtNum(BASE_OPS / n + perShardHot)}. ${
      salted && reads ? `Salting made every read of the hot key fan out to ${SALT} sub-keys, so all shards carry it ${SALT}×.` : salted ? `The hot key's writes are split over ${SALT} salted sub-keys on every shard.` : `One key cannot be split by adding shards: it always hashes to one place.`
    }`,
  };
}

// ------------------------------------------------ §8 monotonic key with range sharding
const RANGE_SHARDS = 6;
const READ_OPS = 9_000;

function monotonicModel(t: number, live: Set<string>, p: Params): Tick {
  const n = live.has('addshard') ? RANGE_SHARDS + 1 : RANGE_SHARDS;
  const inserts = 3000 + (p.knob - 3000) * ramp(t);
  const hashed = live.has('hashkey');
  const nodes = Array.from({ length: n }, (_, i) => {
    const latest = i === n - 1;
    const readShare = READ_OPS / n;
    const lam = readShare + (hashed ? inserts / n : latest ? inserts : 0);
    const cores = latest && live.has('vertical') ? 32 : 16;
    return { name: hashed ? `shard-${i + 1}` : i === n - 1 ? 'newest range' : `range ${i + 1}`, lambda: lam, servers: cores, svcMs: 2.5, baseMs: 6 };
  });
  return {
    nodes,
    says: hashed
      ? `hash(order_id) + a time bucket spreads ${fmtNum(inserts)} inserts/s over ${n} shards: ${fmtNum(inserts / n)} each.`
      : `Every new order has the largest created_at, so all ${fmtNum(inserts)} inserts/s land on the newest range shard; the older ranges only see reads.`,
  };
}

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  sticky: {
    id: 'sticky',
    label: 'One server hot, peers idle',
    nodeKind: 'API nodes',
    summary: () =>
      `§3. ${API_RPS} req/s behind nginx ip_hash across 4 API nodes, each ${API_WORKERS} workers × ${API_SVC} ms = ${(API_WORKERS * 1000) / API_SVC} req/s. Average utilisation is only ${fmtPct(API_RPS / 4 / ((API_WORKERS * 1000) / API_SVC))}.`,
    trigger: (p) => `minute ${TRIGGER}: a mobile carrier moves its users behind CGNAT; soon ${p.knob}% of all users share one public IP, and ip_hash sends that IP to one node.`,
    knob: { label: 'Users behind the one CGNAT IP', min: 10, max: 60, step: 5, def: 40, unit: (v) => `${v}%` },
    fixes: [
      { id: 'addnodes', label: 'Add 2 nodes', why: (p) => `Autoscaling spreads the other users thinner, but the CGNAT IP still hashes to one node: it keeps ${p.knob}% of all traffic on its own. Adding capacity does not fix skew.` },
      { id: 'restart', label: 'Restart the hot node', why: () => `For one minute ip_hash re-maps the hot IP to the next node, which melts instead; when api-1 returns, the IP hashes back to it. Restarting only moves the fire.` },
      { id: 'leastconn', label: 'Sessions → Redis, ip_hash → least_conn', why: () => `With session state in Redis no request needs a particular node, so least_conn balances by live connections: every node gets the same share.` },
    ],
    model: (t, live, p) => stickyModel(t, live, p),
  },
  celebrity: {
    id: 'celebrity',
    label: 'Hot shard (celebrity key)',
    nodeKind: 'DB shards',
    hasKind: true,
    summary: (p) =>
      `§8. ${SHARDS} shards by hash(key), each ${SHARD_CORES} cores × ${SHARD_MS} ms = ${fmtNum((SHARD_CORES * 1000) / SHARD_MS)} ops/s. ${fmtNum(BASE_OPS)} ops/s spread evenly (≈${fmtPct(BASE_OPS / SHARDS / 8000)} each). The hot traffic will be ${p.kind}.`,
    trigger: (p) => `minute ${TRIGGER}: a product goes viral. ${fmtNum(p.knob)} ${p.kind}/s for one key, and one key always hashes to one shard.`,
    knob: { label: 'Traffic on the viral key', min: 2000, max: 20000, step: 1000, def: 12000, unit: (v) => `${fmtNum(v)}/s` },
    fixes: [
      { id: 'cache', label: 'Cache hot reads (5 s TTL)', why: (p) => (p.kind === 'reads' ? `Even a 5 s TTL collapses a celebrity key: almost every read is a cache hit, and the shard sees a trickle of refreshes.` : `A read cache does nothing for writes: every like/increment still has to reach the shard that owns the key.`) },
      { id: 'salt', label: `Salt the key (key#0..${SALT - 1})`, why: (p) => (p.kind === 'writes' ? `Writes pick a random sub-key, so the hot key's writes spread over every shard; reads aggregate the ${SALT} sub-keys, which is cheap when reads are rare.` : `Salting is for hot writes. Here every read must fetch all ${SALT} sub-keys, so the hot key now costs ${SALT}× on every shard. Worse than before.`) },
      { id: 'replicas', label: 'Add 2 replicas to the hot shard', why: (p) => (p.kind === 'reads' ? `Reads for the hot shard can go to three copies, tripling its read capacity. It works, at the cost of replica lag and hardware for one key.` : `Replicas only serve reads; every write still goes to the one primary.`) },
      { id: 'reshard', label: 'Reshard 8 → 16', why: () => `Doubling the shards halves the background load per shard, but the viral key still lives on exactly one of them.` },
    ],
    model: (t, live, p) => celebrityModel(t, live, p),
  },
  monotonic: {
    id: 'monotonic',
    label: 'Newest shard hot (range key)',
    nodeKind: 'range shards',
    summary: () =>
      `§8. Orders are range-sharded by created_at over ${RANGE_SHARDS} shards (16 cores × 2.5 ms each ≈ 6.4k ops/s). Reads (${fmtNum(READ_OPS)}/s) spread across history; inserts are 3k/s.`,
    trigger: (p) => `minute ${TRIGGER}: sale day. Inserts climb to ${fmtNum(p.knob)}/s, and every one of them has the newest timestamp.`,
    knob: { label: 'Inserts per second at peak', min: 4000, max: 12000, step: 500, def: 8000, unit: (v) => `${fmtNum(v)}/s` },
    fixes: [
      { id: 'addshard', label: 'Add a shard for the next range', why: () => `The new shard owns the newest range, so it becomes the one taking every insert. A range key on a monotonic value always has exactly one hot end.` },
      { id: 'vertical', label: 'Scale up the newest shard ×2', why: () => `Twice the cores buys headroom today (a valid "fix now"), but the next peak, or the next range, hits the same wall.` },
      { id: 'hashkey', label: 'Re-key: hash + time bucket', why: () => `Hashing the id spreads inserts over every shard; adding a time bucket keeps time-range queries targeted. Every shard shares the write load.` },
    ],
    model: (t, live, p) => monotonicModel(t, live, p),
  },
};

export const SCENARIO_IDS: ScenarioId[] = ['celebrity', 'monotonic', 'sticky'];

function evaluate(tk: Tick) {
  const results: StationResult[] = tk.nodes.map((n) => station({ lambda: n.lambda, servers: n.servers, svcMs: n.svcMs, timeoutMs: 5000 }));
  const classes: RequestClass[] = tk.nodes.map((n, i) => ({ share: n.lambda, baseMs: n.baseMs, stations: [results[i]] }));
  const rps = tk.nodes.reduce((a, n) => a + n.lambda, 0);
  const m = metricsFor(rps, classes);
  const nodes: NodeLoad[] = tk.nodes.map((n, i) => ({ name: n.name, lambda: n.lambda, capacity: (n.servers * 1000) / n.svcMs, rho: results[i].rho, down: n.down }));
  const up = nodes.filter((n) => !n.down).map((n) => n.rho).sort((a, b) => a - b);
  const median = up.length % 2 ? up[(up.length - 1) / 2] : (up[up.length / 2 - 1] + up[up.length / 2]) / 2;
  const skew = median > 0 ? up[up.length - 1] / median : 1;
  return { m, nodes, skew };
}

export function simulate(p: Params): Frame[] {
  const sc = SCENARIOS[p.scenario];
  const chosen = sc.fixes.filter((f) => p.fixes.includes(f.id));
  const frames: Frame[] = [];
  const p50: number[] = [];
  const p99: number[] = [];
  const err: number[] = [];
  const start = evaluate(sc.model(0, new Set(), p));
  frames.push({
    tick: -1,
    nodes: start.nodes,
    p50: [],
    p99: [],
    err: [],
    rps: start.m.rps,
    skew: start.skew,
    live: [],
    caption: `${sc.summary(p)} ${chosen.length ? `Your mitigations (${chosen.map((f) => f.label).join(', ')}) go live at minute ${FIX_AT}.` : `Pick mitigations above; they go live at minute ${FIX_AT}.`}`,
  });
  let before: { p99: number; err: number; skew: number } | undefined;
  for (let t = 0; t < TICKS; t++) {
    const live = new Set(t >= FIX_AT ? chosen.map((f) => f.id) : []);
    const tk = sc.model(t, live, p);
    const r = evaluate(tk);
    p50.push(r.m.p50);
    p99.push(r.m.p99);
    err.push(r.m.errRate);
    const nums = `p99 ${fmtMs(r.m.p99)}, errors ${fmtPct(r.m.errRate)}, hottest/median ${r.skew.toFixed(1)}×.`;
    let caption: string;
    let predict: string | undefined;
    if (t < TRIGGER) caption = `minute ${t}: healthy. Every ${sc.nodeKind.replace(/s$/, '')} is between ${fmtPct(Math.min(...r.nodes.map((n) => n.rho)))} and ${fmtPct(Math.max(...r.nodes.map((n) => n.rho)))} busy. ${nums}`;
    else if (t === TRIGGER) caption = `${sc.trigger(p)} ${nums}`;
    else if (t === FIX_AT) {
      caption = chosen.length
        ? `minute ${t}: mitigation live. ${chosen.map((f) => f.why(p)).join(' ')} Now ${nums}`
        : `minute ${t}: no mitigation chosen, so the hot spot stays. ${nums} Toggle a fix above to replay with it.`;
    } else caption = `minute ${t}: ${tk.says} ${nums}`;
    if (t === FIX_AT - 1) {
      before = { p99: r.m.p99, err: r.m.errRate, skew: r.skew };
      predict = chosen.length
        ? `${chosen.map((f) => f.label).join(' + ')} go${chosen.length === 1 ? 'es' : ''} live next minute. Will the hottest ${sc.nodeKind.replace(/s$/, '')} cool down, or just the others?`
        : `Nothing is selected. Would adding capacity fix a hot spot caused by skew?`;
    }
    if (t === TICKS - 1 && before)
      caption += ` Summary: p99 ${fmtMs(before.p99)} → ${fmtMs(r.m.p99)}, errors ${fmtPct(before.err)} → ${fmtPct(r.m.errRate)}, skew ${before.skew.toFixed(1)}× → ${r.skew.toFixed(1)}×.`;
    frames.push({ tick: t, nodes: r.nodes, p50: [...p50], p99: [...p99], err: [...err], rps: r.m.rps, skew: r.skew, live: [...live], caption, predict });
  }
  return frames;
}
