// Shared, pure queueing maths for the production-incident simulators (prod-* widgets).
// Every "station" (a DB, a connection pool, an event loop, a socket pool) is modelled as an
// M/M/c queue in steady state for one tick: Erlang C gives the probability a request has to
// wait, and the wait (when it happens) is exponential with rate (c − a)/svc. That is enough
// to reproduce the shapes on-call engineers actually see:
//   * latency is flat until utilisation nears 100 %, then p99 explodes before p50 moves;
//   * past 100 % the queue only stops growing at the timeout, so p99 ≈ timeout and the
//     excess becomes errors;
//   * by Little's law, busy servers = arrival rate × hold time.
// Nothing here depends on React, so the check script can unit-test it directly.

export interface Station {
  /** arrivals per second */
  lambda: number;
  /** parallel servers: cores, pooled connections, sockets, event loops… */
  servers: number;
  /** mean hold time of one visit, ms */
  svcMs: number;
  /** a request that would wait longer than this is dropped (504 / pool timeout), ms */
  timeoutMs: number;
}

export interface StationResult extends Station {
  /** offered load in servers (Little's law: λ × hold time) */
  offered: number;
  /** utilisation = offered / servers (can exceed 1) */
  rho: number;
  /** probability an arrival has to queue (Erlang C) */
  pWait: number;
  /** rate of the exponential wait, per ms (0 when overloaded) */
  decay: number;
  /** fraction of arrivals dropped because their wait would pass the timeout */
  errRate: number;
  /** average number of busy servers */
  busy: number;
  /** average number of requests waiting */
  queued: number;
  overloaded: boolean;
}

/** Erlang C: probability an arrival waits in an M/M/c queue with offered load a (< c). */
export function erlangC(c: number, a: number): number {
  if (a <= 0) return 0;
  if (a >= c) return 1;
  let b = 1; // Erlang B by the stable recurrence
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
  const rho = a / c;
  return b / (1 - rho * (1 - b));
}

export function station(s: Station): StationResult {
  const servers = Math.max(1, Math.round(s.servers));
  const offered = s.lambda * (s.svcMs / 1000);
  const rho = offered / servers;
  if (s.lambda <= 0 || s.svcMs <= 0) {
    return { ...s, servers, offered: 0, rho: 0, pWait: 0, decay: Infinity, errRate: 0, busy: 0, queued: 0, overloaded: false };
  }
  if (rho >= 0.999) {
    // Overloaded: the queue grows until the timeout trims it. Throughput is capped at the
    // servers' capacity; everything above it waits ~timeout and is then dropped.
    const errRate = Math.max(0, 1 - 1 / rho);
    const queued = s.lambda * (s.timeoutMs / 1000);
    return { ...s, servers, offered, rho, pWait: 1, decay: 0, errRate, busy: servers, queued, overloaded: true };
  }
  const pWait = erlangC(servers, offered);
  const decay = (servers - offered) / s.svcMs; // per ms
  const errRate = pWait * Math.exp(-decay * s.timeoutMs);
  const meanWait = pWait / decay;
  return { ...s, servers, offered, rho, pWait, decay, errRate, busy: offered, queued: s.lambda * (meanWait / 1000), overloaded: false };
}

/** q-quantile of the queueing delay at a station (ms), capped at its timeout. */
export function waitQuantile(r: StationResult, q: number): number {
  if (r.overloaded) {
    // everyone who gets served has queued for most of the timeout; the rest hit it
    return r.timeoutMs * (0.75 + 0.25 * q);
  }
  if (1 - q >= r.pWait || r.decay === Infinity) return 0;
  return Math.min(r.timeoutMs, Math.log(r.pWait / (1 - q)) / r.decay);
}

/** A class of requests: what fraction of traffic it is and what its latency is made of. */
export interface RequestClass {
  share: number;
  /** time not spent queueing: CPU, network, the sum of service times on the path (ms) */
  baseMs: number;
  /** stations whose queueing delay this request pays (one visit each) */
  stations: StationResult[];
  /** extra error probability for this class (dependency failing, rejected by bulkhead…) */
  extraErr?: number;
  /** hard cap on latency (client/gateway deadline), ms */
  capMs?: number;
}

// Service-time spread: a request's base time at quantile q is base × (0.7 + 0.3·(−ln(1−q))),
// mean ≈ base, p50 ≈ 0.9 × base, p99 ≈ 2.1 × base (a typical lognormal-ish body).
const baseAt = (base: number, q: number) => base * (0.7 + 0.3 * -Math.log(1 - Math.min(q, 0.9999)));

/** Latency of one class at quantile q: comonotonic sum of base spread and the dominant wait. */
export function classQuantile(c: RequestClass, q: number): number {
  // queueing delay is dominated by the most utilised station; the others add their mean
  let dom: StationResult | undefined;
  for (const s of c.stations) if (!dom || s.rho > dom.rho) dom = s;
  let others = 0;
  for (const s of c.stations) if (s !== dom) others += s.overloaded ? s.timeoutMs * 0.8 : s.pWait / s.decay;
  const v = baseAt(c.baseMs, q) + (dom ? waitQuantile(dom, q) : 0) + others;
  return c.capMs ? Math.min(c.capMs, v) : v;
}

function classCdf(c: RequestClass, x: number): number {
  let lo = 0;
  let hi = 0.99999;
  if (classQuantile(c, lo) > x) return 0;
  if (classQuantile(c, hi) <= x) return 1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (classQuantile(c, mid) <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** q-quantile of latency over a traffic mix of request classes (ms). */
export function mixQuantile(classes: RequestClass[], q: number): number {
  const live = classes.filter((c) => c.share > 0);
  if (live.length === 0) return 0;
  if (live.length === 1) return classQuantile(live[0], q);
  const total = live.reduce((a, c) => a + c.share, 0);
  let lo = 0;
  let hi = Math.max(...live.map((c) => classQuantile(c, 0.99999))) + 1;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    const f = live.reduce((a, c) => a + (c.share / total) * classCdf(c, mid), 0);
    if (f >= q) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Error rate over a mix: a request fails if any station it visits drops it, or its own extra error fires. */
export function mixErrors(classes: RequestClass[]): number {
  const total = classes.reduce((a, c) => a + c.share, 0) || 1;
  return classes.reduce((acc, c) => {
    let ok = 1 - (c.extraErr ?? 0);
    for (const s of c.stations) ok *= 1 - s.errRate;
    // requests whose total latency reaches the class deadline are cut off there (504)
    if (c.capMs) ok *= classCdf(c, c.capMs * 0.999);
    return acc + (c.share / total) * (1 - ok);
  }, 0);
}

export interface Metrics {
  /** requests per second offered */
  rps: number;
  p50: number;
  p99: number;
  /** 0..1 */
  errRate: number;
}

export function metricsFor(rps: number, classes: RequestClass[]): Metrics {
  return { rps, p50: mixQuantile(classes, 0.5), p99: mixQuantile(classes, 0.99), errRate: mixErrors(classes) };
}

// ---------- formatting shared by the prod-* widgets ----------
export const fmtMs = (ms: number) =>
  ms >= 10_000 ? `${Math.round(ms / 1000)} s` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : ms >= 10 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`;
export const fmtPct = (x: number) => (x <= 0 ? '0%' : x < 0.001 ? '<0.1%' : x < 0.1 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);
export const fmtNum = (x: number) =>
  x >= 10_000 ? `${Math.round(x / 1000)}k` : x >= 1000 ? `${(x / 1000).toFixed(1)}k` : x >= 10 ? String(Math.round(x)) : x.toFixed(1);

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';
export const toneFor = (v: number, warn: number, bad: number): Tone => (v >= bad ? 'bad' : v >= warn ? 'warn' : 'good');
