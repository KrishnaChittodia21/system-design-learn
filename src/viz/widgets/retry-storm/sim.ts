// Pure, deterministic fluid simulation of a retry storm in a call chain
//   users → layer L → … → layer 1 → service B
// Each layer retries a failed downstream call up to R times (nested, so the worst case is
// (1+R)^L calls at B per user request). B has a fixed capacity per tick; when offered more
// than that, rejecting/timing out the excess still costs it work, so goodput collapses.
// Traffic is modelled as fractional "mass" so runs are smooth and exactly repeatable.
import type { BaseFrame } from '../../core';

export type Strategy = 'naive' | 'backoff' | 'budget';

export interface Params {
  strategy: Strategy;
  retries: number;
  layers: number;
}

export interface Frame extends BaseFrame {
  tick: number;
  /** calls arriving at B per tick, history up to and including this tick */
  load: number[];
  /** successful calls at B per tick (= user requests completed) */
  goodput: number[];
  /** user requests that gave up this tick */
  gaveUp: number[];
  /** B's capacity per tick, history */
  capacity: number[];
  /** calls entering each hop this tick: [users→top layer, …, layer1→B] */
  hops: number[];
  phase: 'healthy' | 'incident' | 'storm' | 'recovering';
}

export const USERS = 100;
export const CAPACITY = 150;
export const DEGRADED = 15;
export const INCIDENT_START = 4;
export const INCIDENT_END = 10; // exclusive
export const TICKS = 32;
/** fraction of a unit of work B spends rejecting / timing out a call it cannot serve */
const REJECT_COST = 0.25;
/** every user request has an overall deadline; a retry that cannot start before it is not sent */
export const DEADLINE = 10;
const BACKOFF_BASE = 2;
const BACKOFF_CAP = 16;
const BUDGET_RATIO = 0.1;
const BUDGET_MAX = 20;

export const capacityAt = (t: number) => (t >= INCIDENT_START && t < INCIDENT_END ? DEGRADED : CAPACITY);

/** work B can complete when N calls arrive; past capacity every rejected call still costs REJECT_COST */
export function served(n: number, cap: number) {
  if (n <= cap) return n;
  return Math.max(0, Math.min(cap, (cap - REJECT_COST * n) / (1 - REJECT_COST)));
}

const fmt = (x: number) => (x >= 1000 ? Math.round(x).toLocaleString('en-US') : x >= 10 || x < 0.05 ? String(Math.round(x)) : x.toFixed(1));
const amp = (x: number) => `${(x / USERS).toFixed(1)}×`;

export function simulate({ strategy, retries: R, layers: L }: Params): Frame[] {
  const base = R + 1;
  // state = per-layer attempt counters a[0..L-1] (a[0] = layer next to B), packed in base (R+1)
  const digit = (s: number, k: number) => Math.floor(s / base ** k) % base;
  const lowZero = (s: number, k: number) => s % base ** (k + 1) === 0; // a[0..k] all zero

  const schedule = new Map<number, Map<number, number>>();
  // cohorts are keyed by (start tick, state) so deadlines can be enforced
  const STRIDE = base ** L;
  const add = (t: number, key: number, m: number) => {
    if (m <= 1e-9) return;
    let row = schedule.get(t);
    if (!row) schedule.set(t, (row = new Map()));
    row.set(key, (row.get(key) ?? 0) + m);
  };
  const tokens = Array(L).fill(BUDGET_MAX);

  const load: number[] = [];
  const goodput: number[] = [];
  const gaveUp: number[] = [];
  const capacity: number[] = [];
  const frames: Frame[] = [];
  const worst = base ** L;
  const math =
    R === 0
      ? `With no retries, each user request makes exactly 1 call to B.`
      : `${L} layer${L > 1 ? 's' : ''}, each making up to 1 + ${R} attempts: worst case (1+${R})^${L} = ${worst} call${worst > 1 ? 's' : ''} at B per user request.`;
  const how =
    strategy === 'naive'
      ? 'every layer retries immediately'
      : strategy === 'backoff'
        ? `every layer retries after a full-jitter backoff, random(0, ${BACKOFF_BASE}·2^attempt) ticks`
        : `backoff + jitter, and each layer may retry only while its budget allows (≈${BUDGET_RATIO * 100}% of its requests)`;

  frames.push({
    tick: -1,
    load: [],
    goodput: [],
    gaveUp: [],
    capacity: [],
    hops: Array(L + 1).fill(0),
    phase: 'healthy',
    caption: `${USERS} user requests/tick flow through ${L} layer${L > 1 ? 's' : ''} to service B (capacity ${CAPACITY}/tick); ${how}. ${math} Each request gives up at its ${DEADLINE}-tick deadline.`,
  });

  let recoveredAt = -1;
  let peak = 0;
  for (let t = 0; t < TICKS; t++) {
    add(t, t * STRIDE, USERS);
    const row = schedule.get(t) ?? new Map<number, number>();
    schedule.delete(t);
    const cap = capacityAt(t);
    let n = 0;
    const hops = Array(L + 1).fill(0);
    hops[0] = USERS;
    for (const m of row.values()) n += m;
    // hop h (1..L) carries the calls made by layer k = L-h. Each of them is a fresh invocation
    // of every layer below k, i.e. a B-attempt whose counters a[0..k-1] are all zero.
    for (let h = 1; h <= L; h++) {
      const below = L - h;
      let c = 0;
      for (const [key, m] of row) if (below === 0 || lowZero(key % STRIDE, below - 1)) c += m;
      hops[h] = c;
    }
    const x = served(n, cap);
    const fail = n > 0 ? 1 - x / n : 0;
    // budget deposits: every fresh invocation of layer k earns BUDGET_RATIO tokens
    if (strategy === 'budget')
      for (let k = 0; k < L; k++) {
        let fresh = 0;
        for (const [key, m] of row) if (lowZero(key % STRIDE, k)) fresh += m;
        tokens[k] = Math.min(BUDGET_MAX, tokens[k] + BUDGET_RATIO * fresh);
      }
    let exhausted = 0;
    let retried = 0;
    for (const [key, m0] of row) {
      const s = key % STRIDE;
      const start = Math.floor(key / STRIDE);
      const lastStart = start + DEADLINE - 1; // a retry must start no later than this tick
      let m = m0 * fail;
      if (m <= 1e-9) continue;
      for (let k = 0; k < L && m > 1e-9; k++) {
        const a = digit(s, k);
        if (a >= R) continue; // this layer has used all its attempts → error propagates up
        let allowed = m;
        if (strategy === 'budget') {
          allowed = Math.min(m, tokens[k]);
          tokens[k] -= allowed;
        }
        if (allowed > 1e-9) {
          // new state: a[k]+1, layers below start fresh, layers above unchanged
          const upper = Math.floor(s / base ** (k + 1)) * base ** (k + 1);
          const ns = upper + (a + 1) * base ** k;
          const nk = start * STRIDE + ns;
          if (strategy === 'naive') {
            if (t + 1 <= lastStart) {
              add(t + 1, nk, allowed);
              retried += allowed;
            } else exhausted += allowed;
          } else {
            // full jitter: sleep uniformly in [0, span]; a sleep that would pass the deadline means give up
            const span = Math.min(BACKOFF_CAP, BACKOFF_BASE * 2 ** a);
            for (let d = 0; d <= span; d++) {
              const share = allowed / (span + 1);
              if (t + 1 + d <= lastStart) {
                add(t + 1 + d, nk, share);
                retried += share;
              } else exhausted += share;
            }
          }
        }
        m -= allowed; // denied by the budget → this layer fails, the layer above decides
      }
      exhausted += m;
    }
    load.push(n);
    goodput.push(x);
    gaveUp.push(exhausted);
    capacity.push(cap);
    peak = Math.max(peak, n);

    const incident = t >= INCIDENT_START && t < INCIDENT_END;
    const after = t >= INCIDENT_END;
    let phase: Frame['phase'] = 'healthy';
    if (incident) phase = 'incident';
    else if (after && n > cap) phase = 'storm';
    else if (after && recoveredAt < 0 && n > USERS * 1.05) phase = 'recovering';
    if (after && recoveredAt < 0 && n <= cap && x >= USERS * 0.95) recoveredAt = t;

    const retryShare = n - USERS > 0.5 ? ` (${fmt(USERS)} new + ${fmt(n - USERS)} retries)` : '';
    let caption: string;
    let predict: string | undefined;
    if (t < INCIDENT_START) {
      caption = `t=${t}: healthy. ${fmt(n)} calls reach B (${amp(n)}) and all succeed: retries cost nothing while nothing fails.`;
    } else if (incident) {
      caption =
        `t=${t}: B degrades to ${DEGRADED}/tick. ${fmt(n)} calls arrive (${amp(n)})${retryShare}; only ${fmt(x)} succeed` +
        (n > cap ? `, and rejecting the rest still burns B’s capacity.` : '.') +
        (fail > 0 ? ` ${fmt(retried)} failures become retries${exhausted > 0.5 ? `, ${fmt(exhausted)} users give up` : ''}.` : '');
    } else if (n > cap) {
      caption =
        `t=${t}: the trigger is gone (capacity ${CAPACITY}) but ${fmt(n)} calls arrive (${amp(n)})${retryShare}. ` +
        (x < 1
          ? `Rejecting them eats all of B’s capacity: goodput 0. The retries alone keep B down — a metastable failure.`
          : `B completes only ${fmt(x)}; the rest fail and retry again.`);
    } else if (recoveredAt === t) {
      caption = `t=${t}: RECOVERED. Load is ${fmt(n)} (${amp(n)}), within capacity, and B completes ${fmt(x)} calls/tick.`;
    } else if (after && n > USERS * 1.05) {
      caption = `t=${t}: draining: ${fmt(n)} calls (${amp(n)}) fit in B’s ${CAPACITY}/tick, so the backlog of retries is served and shrinks.`;
    } else {
      caption = `t=${t}: steady again: ${fmt(n)} calls/tick (${amp(n)}), all served.`;
    }
    if (t === INCIDENT_START - 1)
      predict = `Next tick B’s capacity drops to ${DEGRADED}/tick for ${INCIDENT_END - INCIDENT_START} ticks. With ${R} retr${R === 1 ? 'y' : 'ies'} at each of ${L} layer${L > 1 ? 's' : ''}, how many calls can one user request cause at B?`;
    if (t === INCIDENT_END - 1)
      predict = `B’s capacity returns to ${CAPACITY}/tick next tick — more than the ${USERS} user requests/tick. Will goodput recover right away?`;
    if (t === TICKS - 1) {
      const total = load.reduce((a, b) => a + b, 0);
      caption += ` Overall: ${fmt(total)} calls at B for ${fmt(USERS * TICKS)} user requests (${amp(total / TICKS)} average, peak ${amp(peak)}); ${
        recoveredAt >= 0 ? `recovered ${recoveredAt - INCIDENT_END} tick${recoveredAt - INCIDENT_END === 1 ? '' : 's'} after the trigger ended.` : 'still down long after the trigger ended.'
      }${strategy === 'naive' && peak < USERS * worst - 1 ? ` Only the ${DEADLINE}-tick deadline kept the peak below the ${worst}× worst case.` : ''}`;
    }
    frames.push({
      tick: t,
      load: [...load],
      goodput: [...goodput],
      gaveUp: [...gaveUp],
      capacity: [...capacity],
      hops,
      phase,
      caption,
      predict,
    });
  }
  return frames;
}
