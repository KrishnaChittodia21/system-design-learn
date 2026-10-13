// Pure simulation: token bucket vs fixed window vs sliding window counter on one bursty stream.
// Time is discrete: 1 tick = 125 ms, a window = 1 s = 8 ticks.
import type { BaseFrame } from '../../core';

export interface Params {
  /** limit per window (fixed / sliding) and bucket capacity B (token bucket) */
  limit: number;
  /** token bucket refill R, tokens per second (= per window) */
  refill: number;
  /** size of each burst in the request stream */
  burst: number;
}

export const DEFAULT_PARAMS: Params = { limit: 5, refill: 5, burst: 5 };
export const W = 8;
export const TICKS = 24;
export const TICK_MS = 125;

export type AlgoId = 'token' | 'fixed' | 'sliding';
export const ALGOS: AlgoId[] = ['token', 'fixed', 'sliding'];

export interface TickResult {
  allowed: number;
  rejected: number;
}

export interface AlgoState {
  /** results for ticks 0..tick */
  history: TickResult[];
  /** human-readable state after the current tick, e.g. "tokens 2.4 / 5" */
  state: string;
  /** a 0..1 gauge of the state (tokens / B, or count / limit) */
  gauge: number;
  allowedTotal: number;
  /** max allowed inside any W-tick (1 s) span so far */
  maxInWindow: number;
}

export interface Frame extends BaseFrame {
  /** current tick, -1 before the first */
  tick: number;
  arrivals: number[];
  algos: Record<AlgoId, AlgoState>;
}

/** Deterministic bursty stream: a burst straddling the window boundary, a trickle, a later burst. */
export function arrivalsFor(burst: number): number[] {
  const a = new Array<number>(TICKS).fill(0);
  a[W - 1] += burst; // last tick of window 0
  a[W] += burst; // first tick of window 1
  for (const t of [11, 13, 15, 21, 23]) a[t] += 1;
  a[18] += burst;
  return a;
}

function maxSpan(history: TickResult[]): number {
  let best = 0;
  for (let s = 0; s < history.length; s++) {
    let sum = 0;
    for (let t = s; t < Math.min(history.length, s + W); t++) sum += history[t].allowed;
    best = Math.max(best, sum);
  }
  return best;
}

const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

export function simulate({ limit, refill, burst }: Params): Frame[] {
  const arrivals = arrivalsFor(burst);
  const frames: Frame[] = [];
  const perTick = refill / W;

  // token bucket state (starts full, like a new client in the Lua script)
  let tokens = limit;
  // fixed window state
  let fixedCount = 0;
  // sliding window counter state
  let cur = 0;
  let prev = 0;

  const hist: Record<AlgoId, TickResult[]> = { token: [], fixed: [], sliding: [] };
  const mk = (): Record<AlgoId, AlgoState> => {
    const out = {} as Record<AlgoId, AlgoState>;
    for (const id of ALGOS) {
      const h = hist[id].map((x) => ({ ...x }));
      out[id] = { history: h, state: '', gauge: 0, allowedTotal: h.reduce((s, x) => s + x.allowed, 0), maxInWindow: maxSpan(h) };
    }
    return out;
  };

  {
    const algos = mk();
    algos.token.state = `tokens ${r1(tokens)} / ${limit}`;
    algos.token.gauge = 1;
    algos.fixed.state = `window 0: 0 / ${limit}`;
    algos.sliding.state = `est 0 / ${limit}`;
    frames.push({
      tick: -1,
      arrivals,
      algos,
      caption: `Same request stream into three limiters. Fixed and sliding windows allow ${limit} per 1 s window (${W} ticks of ${TICK_MS} ms). The token bucket holds B = ${limit} and refills R = ${refill}/s (${r1(perTick)} per tick).`,
      predict: `Nothing happens until a burst of ${burst} on t=${W - 1}, the last tick of window 0. Which limiters let the whole burst through?`,
    });
  }

  for (let t = 0; t < TICKS; t++) {
    const n = arrivals[t];
    const w = Math.floor(t / W);
    const e = (t % W) / W;
    if (t % W === 0 && t > 0) {
      // window rollover
      prev = cur;
      cur = 0;
      fixedCount = 0;
    }
    if (t > 0) tokens = Math.min(limit, tokens + perTick); // lazy refill, one tick elapsed

    const tb: TickResult = { allowed: 0, rejected: 0 };
    const fx: TickResult = { allowed: 0, rejected: 0 };
    const sw: TickResult = { allowed: 0, rejected: 0 };
    let lastEst = cur + prev * (1 - e);
    for (let i = 0; i < n; i++) {
      // token bucket: spend one token if a whole token is available
      if (tokens >= 1) {
        tokens -= 1;
        tb.allowed++;
      } else tb.rejected++;
      // fixed window counter
      if (fixedCount < limit) {
        fixedCount++;
        fx.allowed++;
      } else fx.rejected++;
      // sliding window counter: estimated = C + P × (1 − e); reject if estimated + 1 > limit
      const est = cur + prev * (1 - e);
      if (est + 1 > limit) sw.rejected++;
      else {
        cur++;
        sw.allowed++;
      }
      lastEst = cur + prev * (1 - e);
    }
    if (n === 0) lastEst = cur + prev * (1 - e);
    hist.token.push(tb);
    hist.fixed.push(fx);
    hist.sliding.push(sw);

    const algos = mk();
    algos.token.state = `tokens ${r1(tokens)} / ${limit}`;
    algos.token.gauge = tokens / limit;
    algos.fixed.state = `window ${w}: ${fixedCount} / ${limit}`;
    algos.fixed.gauge = fixedCount / limit;
    algos.sliding.state = `est ${cur} + ${prev}×${r1(1 - e)} = ${r1(lastEst)} / ${limit}`;
    algos.sliding.gauge = Math.min(1, lastEst / limit);

    const res = (r: TickResult) => `${r.allowed}✓${r.rejected ? ` ${r.rejected}✗` : ''}`;
    // collapse the quiet lead-in before the first burst into a single frame
    if (n === 0 && t < W - 2) continue;
    let caption: string;
    if (n === 0 && t === W - 2) {
      caption = `t=0–${t} (0–${t * TICK_MS} ms): no requests. The bucket stays full at ${r1(tokens)} tokens and both window counters stay at 0.`;
    } else if (n === 0) {
      caption = `t=${t} (${t * TICK_MS} ms): no requests. The bucket refills to ${r1(tokens)} tokens${t % W === 0 && t > 0 ? `; window ${w} starts, so the fixed counter resets to 0 and the sliding counter keeps P = ${prev}` : ''}.`;
    } else if (t === W - 1) {
      caption = `t=${t}: burst of ${n} on the LAST tick of window 0. Token bucket ${res(tb)} (it was full), fixed window ${res(fx)}, sliding ${res(sw)}.`;
    } else if (t === W) {
      caption = `t=${t}: burst of ${n} on the FIRST tick of window 1. Fixed window reset its counter, so it allows ${fx.allowed} more: ${hist.fixed[W - 1].allowed + fx.allowed} in 250 ms against a limit of ${limit}/s. Sliding counts the previous window at weight ${r1(1 - e)}, so it allows ${sw.allowed}; the token bucket has ${r1(tokens + tb.allowed)} token(s), so it allows ${tb.allowed}.`;
    } else {
      caption = `t=${t}: ${n} request${n > 1 ? 's' : ''}. Token bucket ${res(tb)}, fixed ${res(fx)}, sliding ${res(sw)} (estimate ${r1(lastEst)} = C + P × (1 − ${r1(e)})).`;
    }
    let predict: string | undefined;
    if (t === W - 1)
      predict = `Another burst of ${arrivals[W]} arrives at t=${W}, the first tick of window 1, only 125 ms later. How many does each limiter allow now?`;
    if (t + 1 < TICKS && arrivals[t + 1] >= 2 && t + 1 !== W && t + 1 !== W - 1) {
      predict = `A burst of ${arrivals[t + 1]} arrives next. The bucket holds ${r1(Math.min(limit, tokens + perTick))} tokens after refill. How many get through each limiter?`;
    }
    frames.push({ tick: t, arrivals, algos, caption, predict });
  }

  const final = frames[frames.length - 1].algos;
  frames.push({
    tick: TICKS,
    arrivals,
    algos: final,
    caption: `Max allowed in any 1 s span: fixed ${final.fixed.maxInWindow}, sliding ${final.sliding.maxInWindow}, token bucket ${final.token.maxInWindow} (limit ${limit}). Fixed windows leak up to 2× at the boundary; a token bucket allows a burst of B plus R per second sustained.`,
  });
  return frames;
}
