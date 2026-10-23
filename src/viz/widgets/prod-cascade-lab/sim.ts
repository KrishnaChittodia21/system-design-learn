// Cascade simulator for "Incidents III: Async, Dependencies & Resilience" (prod-async-failure §8–10).
// One orders-api pod serves two routes through ONE shared outbound socket pool (HTTP agent):
//   /home     → recommendations (healthy 40 ms)       300 req/s
//   /checkout → payments        (healthy 60 ms)       200 req/s
// At SLOW_AT recommendations becomes slow (not down). By Little's law the sockets it needs
// jump from 12 to RPS × latency, the shared pool saturates and /checkout, which never calls
// recommendations, starts failing too. Mitigations (live at FIX_AT): a timeout, a bulkhead,
// a circuit breaker with a fallback, or scaling the callers. Each tick is 5 seconds.
import type { BaseFrame } from '../../core';
import { fmtMs, fmtPct, mixErrors, mixQuantile, station, type RequestClass, type StationResult } from '../prod-perf-incident-lab/kit/queue';

export const TICK_S = 5;
export const TICKS = 36;
export const SLOW_AT = 4;
export const FIX_AT = 10;
export const RECOVER_AT = 26;
export const HOME_RPS = 300;
export const CHECKOUT_RPS = 200;
export const SOCKETS = 50;
export const RECS_OK_MS = 40;
export const PAY_MS = 60;
export const DEADLINE_MS = 3000;
export const TIMEOUT_MS = 300;
export const BULKHEAD = 20; // healthy recs needs 300 × 40 ms = 12
export const COOL_TICKS = 4; // breaker stays open 20 s before a half-open probe
const APP_MS = 15;

export type FixId = 'timeout' | 'bulkhead' | 'breaker' | 'scale';
export type BreakerState = 'off' | 'closed' | 'open' | 'half-open';

export interface Params {
  fixes: FixId[];
  slowMs: number;
}

export interface RouteNow {
  p50: number;
  p99: number;
  err: number;
  /** served by a fallback (degraded but 200 OK) */
  degraded: boolean;
}

export interface Frame extends BaseFrame {
  tick: number;
  recsSlow: boolean;
  breaker: BreakerState;
  home?: RouteNow;
  checkout?: RouteNow;
  /** socket cells: how many are held by recs calls, by payments calls, and the total */
  sockets: { recs: number; pay: number; total: number; waiting: number; bulkhead: boolean };
  homeP99: number[];
  checkoutP99: number[];
  checkoutErr: number[];
  homeErr: number[];
  live: FixId[];
}

export const FIX_LABELS: Record<FixId, string> = {
  timeout: `Timeout ${TIMEOUT_MS} ms on recs`,
  bulkhead: `Bulkhead: recs ≤ ${BULKHEAD} sockets`,
  breaker: 'Circuit breaker + fallback',
  scale: 'Scale pods ×2',
};

const WHY: Record<FixId, string> = {
  timeout: `The timeout caps how long a recs call can hold a socket at ${TIMEOUT_MS} ms (healthy p99 is ~150 ms), so each failure is fast. But ${HOME_RPS} req/s × ${TIMEOUT_MS} ms is still ${(HOME_RPS * TIMEOUT_MS) / 1000} sockets, more than the pool has.`,
  bulkhead: `Recommendations may use only ${BULKHEAD} of the ${SOCKETS} sockets (it needs 12 when healthy) and is rejected when its compartment is full, so payments keeps ${SOCKETS - BULKHEAD} sockets to itself. /checkout survives; /home still fails unless something gives it a fallback.`,
  breaker: `The breaker counts recs failures; past 50% of at least 20 calls it opens, and calls fail instantly into the fallback (homepage without recommendations). No sockets are spent on a dependency that cannot answer, and recs gets room to recover.`,
  scale: `Twice the pods means twice the sockets, but recommendations still wants ${HOME_RPS} req/s × its latency. Adding callers does not add capacity to the slow callee, and in real life it sends it even more load.`,
};

function routeOf(c: RequestClass, degraded: boolean): RouteNow {
  return { p50: mixQuantile([c], 0.5), p99: mixQuantile([c], 0.99), err: mixErrors([c]), degraded };
}

export function simulate({ fixes, slowMs }: Params): Frame[] {
  const frames: Frame[] = [];
  const homeP99: number[] = [];
  const checkoutP99: number[] = [];
  const checkoutErr: number[] = [];
  const homeErr: number[] = [];
  let breaker: BreakerState = fixes.includes('breaker') ? 'closed' : 'off';
  let openedAt = -1;
  let lastFail = 0;
  let lastVolume = 0;
  const list = (fs: FixId[]) => fs.map((f) => FIX_LABELS[f]).join(', ');

  frames.push({
    tick: -1,
    recsSlow: false,
    breaker: fixes.includes('breaker') ? 'closed' : 'off',
    sockets: { recs: 0, pay: 0, total: SOCKETS, waiting: 0, bulkhead: false },
    homeP99: [],
    checkoutP99: [],
    checkoutErr: [],
    homeErr: [],
    live: [],
    caption: `One orders-api pod, ${HOME_RPS + CHECKOUT_RPS} req/s, one shared pool of ${SOCKETS} outbound sockets. Little's law: ${HOME_RPS} × ${RECS_OK_MS} ms + ${CHECKOUT_RPS} × ${PAY_MS} ms = ${(HOME_RPS * RECS_OK_MS + CHECKOUT_RPS * PAY_MS) / 1000} sockets busy. The gateway deadline is ${DEADLINE_MS / 1000} s. ${
      fixes.length ? `Your mitigations (${list(fixes)}) go live at ${FIX_AT * TICK_S} s.` : `Pick mitigations above; they go live at ${FIX_AT * TICK_S} s.`
    }`,
  });

  for (let t = 0; t < TICKS; t++) {
    const live = t >= FIX_AT ? fixes : [];
    const has = (f: FixId) => live.includes(f);
    const slow = t >= SLOW_AT && t < RECOVER_AT;
    const recsLatency = slow ? slowMs : RECS_OK_MS;

    // breaker transitions decided from the previous tick's outcome
    let breakerNote = '';
    if (has('breaker')) {
      if (breaker === 'off') breaker = 'closed';
      if (breaker === 'closed' && lastVolume >= 20 && lastFail >= 0.5) {
        breaker = 'open';
        openedAt = t;
        breakerNote = `The breaker saw ${fmtPct(lastFail)} of recs calls fail and OPENS. `;
      } else if (breaker === 'open' && t - openedAt >= COOL_TICKS) {
        breaker = 'half-open';
      }
      if (breaker === 'half-open') {
        if (!slow) {
          breaker = 'closed';
          breakerNote = 'HALF-OPEN: the probe calls succeed, so the breaker CLOSES and recommendations come back. ';
        } else {
          breaker = 'open';
          openedAt = t;
          breakerNote = `HALF-OPEN: a few probe calls still take ${fmtMs(slowMs)}, so the breaker re-OPENS for another ${COOL_TICKS * TICK_S} s. `;
        }
      }
    }
    const open = breaker === 'open';
    const fallback = has('breaker'); // the breaker is wired with a fallback for any failed recs call

    const hold = has('timeout') ? Math.min(recsLatency, TIMEOUT_MS) : recsLatency;
    const timedOut = has('timeout') && recsLatency > TIMEOUT_MS;
    const sockets = SOCKETS * (has('scale') ? 2 : 1);
    const recsLam = open ? 0 : HOME_RPS;
    let recsSt: StationResult;
    let paySt: StationResult;
    let shared: StationResult | undefined;
    if (has('bulkhead')) {
      // the compartment rejects immediately when full (tiny queue)
      recsSt = station({ lambda: recsLam, servers: BULKHEAD * (has('scale') ? 2 : 1), svcMs: hold, timeoutMs: 20 });
      paySt = station({ lambda: CHECKOUT_RPS, servers: sockets - BULKHEAD * (has('scale') ? 2 : 1), svcMs: PAY_MS, timeoutMs: DEADLINE_MS });
    } else {
      const lam = recsLam + CHECKOUT_RPS;
      shared = station({ lambda: lam, servers: sockets, svcMs: (recsLam * hold + CHECKOUT_RPS * PAY_MS) / lam, timeoutMs: DEADLINE_MS });
      recsSt = shared;
      paySt = shared;
    }
    // /home: the recs call either completes, times out (error), or is skipped (breaker open)
    const homeRaw: RequestClass = open
      ? { share: 1, baseMs: APP_MS + 1, stations: [] }
      : { share: 1, baseMs: APP_MS + hold, stations: [recsSt], extraErr: timedOut ? 1 : 0, capMs: DEADLINE_MS };
    const recsFail = open ? 1 : mixErrors([homeRaw]);
    // With a fallback, a recs call that fails FAST (timeout, bulkhead rejection) still renders the
    // page without recommendations. A call that is still waiting when the gateway deadline hits
    // cannot fall back: the user already got a 504.
    const homeCls: RequestClass =
      fallback && !open ? { ...homeRaw, extraErr: 0, stations: homeRaw.stations.map((st) => ({ ...st, errRate: 0 })) } : homeRaw;
    const home = routeOf(homeCls, open || (fallback && recsFail > 0.01));
    const checkoutCls: RequestClass = { share: 1, baseMs: APP_MS + PAY_MS, stations: [paySt], capMs: DEADLINE_MS };
    const checkout = routeOf(checkoutCls, false);

    if (has('breaker') && !open) {
      lastFail = recsFail;
      lastVolume = HOME_RPS * TICK_S;
    } else {
      lastFail = 0;
      lastVolume = 0;
    }

    homeP99.push(home.p99);
    checkoutP99.push(checkout.p99);
    checkoutErr.push(checkout.err);
    homeErr.push(home.err);

    // socket occupancy (Little's law), split by who holds them
    const aRecs = recsLam * (hold / 1000);
    const aPay = CHECKOUT_RPS * (PAY_MS / 1000);
    let recsCells: number;
    let payCells: number;
    let waiting: number;
    if (shared) {
      const busy = Math.min(sockets, aRecs + aPay);
      recsCells = aRecs + aPay > 0 ? (busy * aRecs) / (aRecs + aPay) : 0;
      payCells = busy - recsCells;
      waiting = shared.queued;
    } else {
      recsCells = Math.min(recsSt.servers, aRecs);
      payCells = Math.min(paySt.servers, aPay);
      waiting = paySt.queued;
    }

    const sec = `${t * TICK_S}s`;
    const routes = `/checkout p99 ${fmtMs(checkout.p99)}, errors ${fmtPct(checkout.err)}; /home p99 ${fmtMs(home.p99)}, errors ${fmtPct(home.err)}${home.degraded ? ' (fallback)' : ''}.`;
    let caption: string;
    let predict: string | undefined;
    if (t < SLOW_AT) caption = `${sec}: healthy. About ${Math.round(aRecs + aPay)} of ${sockets} sockets busy. ${routes}`;
    else if (t === SLOW_AT)
      caption = `${sec}: recommendations slows from ${RECS_OK_MS} ms to ${fmtMs(slowMs)} (slow, not down). Sockets it wants: ${HOME_RPS} × ${fmtMs(slowMs)} = ${Math.round((HOME_RPS * slowMs) / 1000)}, against a pool of ${sockets}. ${routes}`;
    else if (t === FIX_AT) {
      caption = live.length
        ? `${sec}: mitigation live. ${live.map((f) => WHY[f]).join(' ')} ${breakerNote}${routes}`
        : `${sec}: no mitigation chosen. The pool stays full of calls waiting on recommendations, so /checkout, which never calls it, keeps failing. ${routes}`;
    } else if (t === RECOVER_AT) caption = `${sec}: recommendations recovers (${RECS_OK_MS} ms). ${breakerNote}${routes}`;
    else if (slow)
      caption = `${sec}: ${breakerNote}${
        shared && shared.overloaded
          ? `All ${sockets} sockets are taken, ${Math.round(recsCells)} of them by calls to recommendations; ${Math.round(Math.min(waiting, 99_999))} requests queue for one. `
          : open
            ? 'Breaker OPEN: recs is not called; /home renders without recommendations. '
            : ''
      }${routes}`;
    else caption = `${sec}: ${breakerNote}${routes}`;
    if (t === FIX_AT - 1)
      predict = fixes.length
        ? `${list(fixes)} go${fixes.length === 1 ? 'es' : ''} live next. Will /checkout recover? Will /home?`
        : `Nothing selected. /checkout never calls recommendations; why is it failing?`;
    if (t === TICKS - 1)
      caption += ` Overall: /checkout errors peaked at ${fmtPct(Math.max(...checkoutErr))}; after ${FIX_AT * TICK_S} s they averaged ${fmtPct(checkoutErr.slice(FIX_AT, RECOVER_AT).reduce((a, b) => a + b, 0) / (RECOVER_AT - FIX_AT))} while recs was slow.`;

    frames.push({
      tick: t,
      recsSlow: slow,
      breaker: has('breaker') ? breaker : fixes.includes('breaker') ? 'closed' : 'off',
      home,
      checkout,
      sockets: { recs: recsCells, pay: payCells, total: sockets, waiting, bulkhead: has('bulkhead') },
      homeP99: [...homeP99],
      checkoutP99: [...checkoutP99],
      checkoutErr: [...checkoutErr],
      homeErr: [...homeErr],
      live: [...live],
      caption,
      predict,
    });
  }
  return frames;
}
