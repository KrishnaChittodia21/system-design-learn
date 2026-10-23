// Pure M/M/c queue: Poisson arrivals, exponential service, c identical servers, FCFS.
// For each utilisation level we simulate many requests (seeded, so every run is identical),
// measure latency percentiles and the time-average number in the system independently
// (sampled at arrival instants: Poisson arrivals see time averages), and compare with theory.
import { rng, type BaseFrame } from '../../core';

export const LEVELS = [0.3, 0.5, 0.7, 0.8, 0.9, 0.95];
export const REQUESTS = 40_000;
const WARMUP = 4_000;
/** sparkline window, measured in mean service times */
export const WINDOW_S = 120;

export interface Params {
  servers: number;
  /** mean service time in ms */
  serviceMs: number;
}

export const DEFAULT_PARAMS: Params = { servers: 1, serviceMs: 20 };

export interface LevelStats {
  rho: number;
  /** arrival rate, requests per second */
  lambda: number;
  /** completed per second (measured) */
  throughput: number;
  meanMs: number;
  p50Ms: number;
  p99Ms: number;
  /** time-average number in system, measured by sampling at arrivals */
  L: number;
  /** average number waiting (not in service) */
  Lq: number;
  /** theoretical mean time in system for M/M/c */
  theoryMeanMs: number;
  /** number in system sampled at arrivals over a window of WINDOW_S service times */
  trace: { t: number; n: number }[];
}

export interface Frame extends BaseFrame {
  level: number;
  summary: boolean;
  stats: LevelStats[];
}

function expSample(r: () => number, mean: number) {
  return -Math.log(1 - r()) * mean;
}

/** Erlang C: probability an arrival has to wait in an M/M/c queue with offered load a = λS. */
export function erlangC(c: number, rho: number): number {
  const a = rho * c;
  let term = 1;
  let sum = 1; // k = 0
  for (let k = 1; k < c; k++) {
    term *= a / k;
    sum += term;
  }
  const last = (term * a) / c; // a^c / c!
  const top = last / (1 - rho);
  return top / (sum + top);
}

/** Theoretical mean time in system W for M/M/c, in multiples of the service time S. */
export function theoryW(c: number, rho: number): number {
  return 1 + erlangC(c, rho) / (c * (1 - rho));
}

/** Min-heap of finish times (numbers). */
class Heap {
  a: number[] = [];
  push(x: number) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] <= a[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  peek() {
    return this.a[0];
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l] < a[m]) m = l;
        if (r < a.length && a[r] < a[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

export function simulateLevel(c: number, S: number, rho: number, seed = 7): LevelStats {
  const r = rng(seed + Math.round(rho * 1000) + c * 17);
  const lambda = (rho * c) / S; // per ms
  const free = new Array<number>(c).fill(0); // when each server becomes free
  const inSystem = new Heap(); // finish times of jobs not yet done
  const lat: number[] = [];
  let t = 0;
  let sampledN = 0;
  let samples = 0;
  let firstArrival = 0;
  let lastFinish = 0;
  const trace: { t: number; n: number }[] = [];
  let traceStart = -1;
  for (let i = 0; i < REQUESTS; i++) {
    t += expSample(r, 1 / lambda);
    while (inSystem.size && inSystem.peek() <= t) inSystem.pop();
    const nHere = inSystem.size; // what this arrival sees
    // FCFS: take the server that frees up first
    let k = 0;
    for (let j = 1; j < c; j++) if (free[j] < free[k]) k = j;
    const start = Math.max(t, free[k]);
    const finish = start + expSample(r, S);
    free[k] = finish;
    inSystem.push(finish);
    if (i >= WARMUP) {
      if (i === WARMUP) firstArrival = t;
      lat.push(finish - t);
      sampledN += nHere;
      samples++;
      lastFinish = Math.max(lastFinish, finish);
      if (traceStart < 0) traceStart = t;
      if (t - traceStart <= WINDOW_S * S) trace.push({ t: (t - traceStart) / S, n: nHere });
    }
  }
  lat.sort((x, y) => x - y);
  const q = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
  const meanMs = lat.reduce((s, x) => s + x, 0) / lat.length;
  const L = sampledN / samples;
  const lambdaPerSec = lambda * 1000;
  return {
    rho,
    lambda: lambdaPerSec,
    throughput: (lat.length / (lastFinish - firstArrival)) * 1000,
    meanMs,
    p50Ms: q(0.5),
    p99Ms: q(0.99),
    L,
    Lq: Math.max(0, L - rho * c),
    theoryMeanMs: theoryW(c, rho) * S,
    trace,
  };
}

const r1 = (x: number) => (x >= 100 ? Math.round(x).toLocaleString('en-US') : x.toFixed(1).replace(/\.0$/, ''));

export function simulate(p: Params): Frame[] {
  const stats = LEVELS.map((rho) => simulateLevel(p.servers, p.serviceMs, rho));
  const S = p.serviceMs;
  const frames: Frame[] = stats.map((s, i) => {
    const prev = i > 0 ? stats[i - 1] : undefined;
    const pool = p.servers === 1 ? 'one server' : `${p.servers} servers`;
    let caption = `ρ = ${Math.round(s.rho * 100)}%: ${r1(s.lambda)} req/s into ${pool}, each request needing ${S} ms. p50 ${r1(s.p50Ms)} ms, p99 ${r1(s.p99Ms)} ms; mean ${r1(s.meanMs)} ms (theory ${r1(s.theoryMeanMs)}). Little's law: L = λ × W = ${r1(s.lambda)}/s × ${r1(s.meanMs)} ms = ${r1((s.lambda * s.meanMs) / 1000)} in flight; measured ${r1(s.L)}.`;
    if (prev) {
      caption = `ρ ${Math.round(prev.rho * 100)}% → ${Math.round(s.rho * 100)}%: throughput ×${(s.throughput / prev.throughput).toFixed(2)}, but p99 ×${(s.p99Ms / prev.p99Ms).toFixed(1)} (${r1(prev.p99Ms)} → ${r1(s.p99Ms)} ms). ${s.Lq >= 1 ? `On average ${r1(s.Lq)} requests are waiting in the queue.` : 'The queue is still mostly empty.'} Little's law: ${r1(s.lambda)}/s × ${r1(s.meanMs)} ms ≈ ${r1(s.L)} in flight.`;
    }
    let predict: string | undefined;
    if (s.rho === 0.7) predict = 'Add 10 more points of load (70% → 80%). Does p99 grow by about 14%, or by much more?';
    if (s.rho === 0.9) predict = 'Servers are only 5 points busier at 95%. What happens to the queue?';
    return { level: i, summary: false, stats, caption, predict };
  });
  const lo = stats[1];
  const hi = stats[stats.length - 1];
  frames.push({
    level: stats.length - 1,
    summary: true,
    stats,
    caption: `From 50% to 95% busy, throughput grew ×${(hi.throughput / lo.throughput).toFixed(1)} while p99 grew ×${(hi.p99Ms / lo.p99Ms).toFixed(1)}. Waiting time ∝ 1/(1−ρ): it is the idle gaps that absorb bursts. That is why capacity plans target 60–70% at peak${p.servers === 1 ? '. Try 8 servers: pooling one queue across many servers keeps waits low at the same utilisation.' : ', and why one shared queue across many servers (pooling) waits less than many single-server queues.'}`,
  });
  return frames;
}
