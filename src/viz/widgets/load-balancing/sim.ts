// Pure simulation: round robin vs least connections vs power-of-two-choices on the same arrivals,
// with one slow server. Each server has WORKERS parallel slots; extra requests queue FIFO.
// "In-flight" = running + queued: what an LB can count from its own open requests.
import { rng, type BaseFrame } from '../../core';

export type AlgoId = 'rr' | 'lc' | 'p2c';
export const ALGOS: AlgoId[] = ['rr', 'lc', 'p2c'];

export interface Params {
  servers: number;
  /** service time of the slow server, in ticks (fast servers take FAST_TICKS) */
  slowTicks: number;
  /** arriving requests per tick */
  rate: number;
}

export const DEFAULT_PARAMS: Params = { servers: 5, slowTicks: 10, rate: 3 };
export const FAST_TICKS = 2;
export const WORKERS = 2;
export const TICKS = 24;
export const TICK_MS = 50;
export const SLOW = 1; // index of the slow server ("S2")

interface Req {
  arrival: number;
  /** tick at which it finishes (set when it starts running) */
  done?: number;
}

export interface ServerView {
  running: number;
  queued: number;
  /** requests dispatched to this server so far */
  sent: number;
  /** requests dispatched this tick */
  justSent: number;
}

export interface AlgoView {
  servers: ServerView[];
  completed: number;
  /** p50 / p99 latency in ms of every request dispatched so far (queued ones at their exact eventual finish) */
  p50: number;
  p99: number;
  /** share of all requests so far sent to the slow server */
  slowShare: number;
  /** for P2C: the two sampled servers of the last dispatch this tick */
  lastPair?: [number, number];
}

export interface Frame extends BaseFrame {
  tick: number;
  arrivedTotal: number;
  algos: Record<AlgoId, AlgoView>;
}

export function arrivalsAt(t: number, rate: number): number {
  return Math.floor((t + 1) * rate) - Math.floor(t * rate);
}

export function serviceTicks(server: number, slowTicks: number): number {
  return server === SLOW ? slowTicks : FAST_TICKS;
}

class Balancer {
  running: Req[][];
  queue: Req[][];
  sent: number[];
  justSent: number[];
  finished: number[] = [];
  rrNext = 0;
  lcCursor = 0;
  lastPair?: [number, number];
  private rand: () => number;
  readonly algo: AlgoId;
  readonly n: number;
  readonly slowTicks: number;
  constructor(algo: AlgoId, n: number, slowTicks: number, seed: number) {
    this.algo = algo;
    this.n = n;
    this.slowTicks = slowTicks;
    this.running = Array.from({ length: n }, () => []);
    this.queue = Array.from({ length: n }, () => []);
    this.sent = new Array(n).fill(0);
    this.justSent = new Array(n).fill(0);
    this.rand = rng(seed);
  }
  inFlight(i: number) {
    return this.running[i].length + this.queue[i].length;
  }
  /** retire requests finishing at or before t, then start queued ones */
  complete(t: number) {
    for (let i = 0; i < this.n; i++) {
      const still: Req[] = [];
      for (const r of this.running[i]) {
        if (r.done! <= t) this.finished.push(r.done! - r.arrival);
        else still.push(r);
      }
      this.running[i] = still;
      while (this.running[i].length < WORKERS && this.queue[i].length) {
        const r = this.queue[i].shift()!;
        r.done = t + serviceTicks(i, this.slowTicks);
        this.running[i].push(r);
      }
    }
  }
  pick(): number {
    if (this.algo === 'rr') {
      const i = this.rrNext;
      this.rrNext = (this.rrNext + 1) % this.n;
      return i;
    }
    if (this.algo === 'lc') {
      // fewest in-flight; ties broken by rotating the start index so ties spread evenly
      let best = -1;
      for (let k = 0; k < this.n; k++) {
        const i = (this.lcCursor + k) % this.n;
        if (best < 0 || this.inFlight(i) < this.inFlight(best)) best = i;
      }
      this.lcCursor = (best + 1) % this.n;
      return best;
    }
    const i = Math.floor(this.rand() * this.n);
    let j = Math.floor(this.rand() * (this.n - 1));
    if (j >= i) j++; // two distinct servers
    this.lastPair = [i, j];
    return this.inFlight(i) <= this.inFlight(j) ? i : j;
  }
  dispatch(t: number, count: number) {
    this.justSent.fill(0);
    for (let k = 0; k < count; k++) {
      const s = this.pick();
      this.sent[s]++;
      this.justSent[s]++;
      const r: Req = { arrival: t };
      if (this.running[s].length < WORKERS) {
        r.done = t + serviceTicks(s, this.slowTicks);
        this.running[s].push(r);
      } else this.queue[s].push(r);
    }
  }
  view(): AlgoView {
    // Exact eventual latency of every request dispatched so far: completed ones are known, and
    // FIFO per server means a queued request's finish time depends only on requests ahead of it.
    const lat = [...this.finished];
    for (let i = 0; i < this.n; i++) {
      const free = this.running[i].map((r) => r.done!);
      for (const r of this.running[i]) lat.push(r.done! - r.arrival);
      for (const r of this.queue[i]) {
        free.sort((a, b) => a - b);
        const done = free[0] + serviceTicks(i, this.slowTicks);
        free[0] = done;
        lat.push(done - r.arrival);
      }
    }
    lat.sort((a, b) => a - b);
    const q = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.ceil(p * lat.length) - 1)] * TICK_MS : 0);
    const total = this.sent.reduce((s, x) => s + x, 0);
    return {
      servers: this.sent.map((sent, i) => ({ running: this.running[i].length, queued: this.queue[i].length, sent, justSent: this.justSent[i] })),
      completed: this.finished.length,
      p50: q(0.5),
      p99: q(0.99),
      slowShare: total ? this.sent[SLOW] / total : 0,
      lastPair: this.lastPair,
    };
  }
}

const NAME: Record<AlgoId, string> = { rr: 'Round robin', lc: 'Least connections', p2c: 'P2C' };

export function simulate({ servers, slowTicks, rate }: Params): Frame[] {
  const frames: Frame[] = [];
  const lbs = ALGOS.map((a) => new Balancer(a, servers, slowTicks, 7));
  const views = () => Object.fromEntries(ALGOS.map((a, k) => [a, lbs[k].view()])) as Record<AlgoId, AlgoView>;
  const slowCap = WORKERS / slowTicks;
  const fastCap = WORKERS / FAST_TICKS;
  let arrived = 0;

  frames.push({
    tick: -1,
    arrivedTotal: 0,
    algos: views(),
    caption: `${servers} servers with ${WORKERS} workers each; extra requests queue. Fast servers take ${FAST_TICKS * TICK_MS} ms, S${SLOW + 1} takes ${slowTicks * TICK_MS} ms, so it can finish only ${slowCap.toFixed(2)} req/tick against ${fastCap} for the others. ${rate} req/tick arrive.`,
    predict: `Round robin sends every ${servers}th request (${(rate / servers).toFixed(2)} req/tick) to S${SLOW + 1}. What happens to S${SLOW + 1}'s queue over time?`,
  });

  for (let t = 0; t < TICKS; t++) {
    const n = arrivalsAt(t, rate);
    arrived += n;
    for (const lb of lbs) {
      lb.complete(t);
      lb.dispatch(t, n);
    }
    const v = views();
    const rr = lbs[0];
    const lc = lbs[1];
    const p2 = lbs[2];
    const slowIF = (lb: Balancer) => lb.inFlight(SLOW);
    let caption: string;
    if (t === 0) {
      caption = `t=0: ${n} request${n > 1 ? 's' : ''}. All servers are idle, so every algorithm spreads them out; nothing can tell S${SLOW + 1} is slow yet.`;
    } else if (t === TICKS - 1) {
      caption = `t=${t}: S${SLOW + 1} holds ${slowIF(rr)} in-flight under RR, ${slowIF(lc)} under least-conn and ${slowIF(p2)} under P2C. p99: RR ${v.rr.p99} ms, least-conn ${v.lc.p99} ms, P2C ${v.p2c.p99} ms.`;
    } else {
      const backlog = rr.queue[SLOW].length;
      caption = `t=${t}: ${n} arrive. RR still sends S${SLOW + 1} its turn: ${backlog} queued there, p99 ${v.rr.p99} ms. Least-conn sees S${SLOW + 1}'s open requests and keeps it at ${slowIF(lc)} in-flight; P2C at ${slowIF(p2)}${p2.lastPair ? ` (last pair S${p2.lastPair[0] + 1} vs S${p2.lastPair[1] + 1})` : ''}.`;
    }
    let predict: string | undefined;
    if (t === 7)
      predict = `P2C looks at only two random servers per request, not all ${servers}. Will its p99 end up closer to round robin or to least connections?`;
    if (t === 15) predict = `Requests keep arriving at ${rate}/tick. Over the last 8 ticks, does RR's p99 level off or keep growing?`;
    frames.push({ tick: t, arrivedTotal: arrived, algos: v, caption, predict });
  }

  const last = frames[frames.length - 1].algos;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  frames.push({
    tick: TICKS,
    arrivedTotal: arrived,
    algos: last,
    caption:
      rate / servers > slowCap
        ? `Why RR piles up: it ignores load, so S${SLOW + 1} gets ${pct(last.rr.slowShare)} of requests at ${(rate / servers).toFixed(2)} req/tick but serves only ${slowCap.toFixed(2)}; its queue grows without bound. Least-conn sent it ${pct(last.lc.slowShare)}, P2C ${pct(last.p2c.slowShare)}: two random samples are almost as good as checking all.`
        : `At this rate S${SLOW + 1} keeps up even with its 1/${servers} share (${(rate / servers).toFixed(2)} ≤ ${slowCap.toFixed(2)} req/tick), so RR does not pile up. Raise the rate or the slow latency to see the queue explode.`,
  });
  return frames;
}

export { NAME };
