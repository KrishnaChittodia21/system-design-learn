// Pure, deterministic simulation of a hot cache key expiring under concurrent load.
// One tick ≈ 100 ms; `rps` requests for the same key arrive every tick.
import { rng, type BaseFrame } from '../../core';

export type Strategy = 'none' | 'lock' | 'swr' | 'xfetch';

export interface Params {
  strategy: Strategy;
  /** concurrent requests for the hot key per tick */
  rps: number;
  /** recompute time (Δ) in ticks */
  recompute: number;
}

export type CacheState = 'fresh' | 'expired' | 'stale' | 'refreshing';

export interface TickStats {
  hits: number;
  stale: number;
  waits: number;
  misses: number;
  dbStarted: number;
  dbInflight: number;
  maxLatency: number;
}

export interface Frame extends BaseFrame {
  /** first and last tick covered by this frame (quiet stretches are merged into one frame) */
  from: number;
  tick: number;
  cache: CacheState;
  /** the tick at which the key (soft-)expires */
  expireAt: number;
  ticks: number;
  /** per-tick history up to and including `tick` */
  history: TickStats[];
  totalDb: number;
  totalStale: number;
  peakInflight: number;
}

export const DB_POOL = 20;
export const BETA = 1;
const TTL_AFTER_REFILL = 60;

export const STRATEGY_LABELS: Record<Strategy, string> = {
  none: 'no protection',
  lock: 'single-flight / lock',
  swr: 'stale-while-revalidate',
  xfetch: 'XFetch early refresh',
};

/** Expiry tick: late enough that XFetch's typical head start (≈ Δ·β·ln(rps·Δ)) fits in the window. */
export function expiryTick(rps: number, D: number) {
  return Math.min(28, Math.ceil(D * BETA * Math.log(rps * D)) + 6);
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

interface TickRec {
  t: number;
  s: TickStats;
  cache: CacheState;
  fresh: boolean;
  finished: number;
  stillInflight: number;
  triggers: number;
  expiresAt: number;
  waitedSoFar: number;
}

export function simulate({ strategy, rps, recompute: D }: Params): Frame[] {
  const E = expiryTick(rps, D);
  const TICKS = E + D + 6;
  const rand = rng(1234 + rps * 31 + D);

  // hard expiry (none/lock/xfetch) or soft expiry (swr: the hard TTL is far away)
  let expiresAt = E;
  let inflight: number[] = []; // completion ticks of running recomputes
  let loaderDoneAt = -1; // single-flight / refresh lock: completion tick of the one loader
  let expiredMisses = 0;
  let waited = 0;
  const recs: TickRec[] = [];

  for (let t = 0; t < TICKS; t++) {
    // recomputes finishing at the start of this tick write the value back
    const finished = inflight.filter((d) => d <= t).length;
    inflight = inflight.filter((d) => d > t);
    if (finished > 0) expiresAt = t + TTL_AFTER_REFILL;
    if (loaderDoneAt >= 0 && loaderDoneAt <= t) loaderDoneAt = -1;

    const s: TickStats = { hits: 0, stale: 0, waits: 0, misses: 0, dbStarted: 0, dbInflight: 0, maxLatency: 0 };
    const fresh = t < expiresAt;
    let triggers = 0;

    for (let r = 0; r < rps; r++) {
      if (strategy === 'xfetch' && fresh) {
        const u = Math.max(rand(), 1e-12);
        // XFetch: refresh early if now − Δ·β·ln(U) ≥ expiry. This reader recomputes (pays Δ); others still hit.
        if (t - D * BETA * Math.log(u) >= expiresAt) {
          triggers++;
          s.misses++;
          s.dbStarted++;
          inflight.push(t + D);
          s.maxLatency = Math.max(s.maxLatency, D);
        } else s.hits++;
        continue;
      }
      if (fresh) {
        s.hits++;
        continue;
      }
      if (strategy === 'none' || strategy === 'xfetch') {
        // key is gone: every request recomputes on its own
        expiredMisses++;
        s.misses++;
        s.dbStarted++;
        inflight.push(t + D);
        s.maxLatency = Math.max(s.maxLatency, D);
      } else if (strategy === 'lock') {
        if (loaderDoneAt < 0) {
          loaderDoneAt = t + D; // SET lock NX won: the only loader
          inflight.push(loaderDoneAt);
          s.misses++;
          s.dbStarted++;
        } else {
          s.waits++;
          waited++;
        }
        s.maxLatency = Math.max(s.maxLatency, loaderDoneAt - t);
      } else {
        // swr: value still present until the hard TTL → serve stale, one deduplicated refresh
        s.stale++;
        if (loaderDoneAt < 0) {
          loaderDoneAt = t + D;
          inflight.push(loaderDoneAt);
          s.dbStarted++;
        }
      }
    }
    s.dbInflight = inflight.length;
    const cache: CacheState = fresh ? 'fresh' : inflight.length ? 'refreshing' : strategy === 'swr' ? 'stale' : 'expired';
    recs.push({ t, s, cache, fresh, finished, stillInflight: inflight.length, triggers, expiresAt, waitedSoFar: waited });
  }

  // ---- build frames, merging quiet stretches (all hits, DB idle) into one frame ----
  const frames: Frame[] = [];
  const intro: Record<Strategy, string> = {
    none: `A hot key gets ${rps} requests per tick and expires at t=${E}. With no protection, every request that misses runs the ${D}-tick recompute itself.`,
    lock: `A hot key gets ${rps} requests per tick and expires at t=${E}. With single-flight or a lock, the first miss loads the value and everyone else waits for that one result.`,
    swr: `The hot key has a soft TTL at t=${E} and a much longer hard TTL. After the soft expiry, readers get the stale value at once and one background refresh runs.`,
    xfetch: `XFetch: each reader refreshes early if now − Δ·β·ln(rand) ≥ expiry (Δ=${D}, β=${BETA}, expiry t=${E}). The odds rise as expiry approaches, and there is no lock or coordination.`,
  };
  let totalDb = 0;
  let totalStale = 0;
  let peak = 0;
  const hist: TickStats[] = [];
  const push = (from: number, r: TickRec, caption: string, predict?: string) =>
    frames.push({
      from,
      tick: r.t,
      cache: r.cache,
      expireAt: E,
      ticks: TICKS,
      history: hist.map((h) => ({ ...h })),
      totalDb,
      totalStale,
      peakInflight: peak,
      caption,
      predict,
    });

  frames.push({
    from: -1,
    tick: -1,
    cache: 'fresh',
    expireAt: E,
    ticks: TICKS,
    history: [],
    totalDb: 0,
    totalStale: 0,
    peakInflight: 0,
    caption: intro[strategy],
    predict: strategy === 'xfetch' ? `Nobody coordinates. With ${rps} readers per tick, who refreshes the key, and when? Will anyone miss at t=${E}?` : undefined,
  });

  const quiet = (r: TickRec) => r.fresh && r.s.dbStarted === 0 && r.finished === 0 && r.stillInflight === 0;
  // long quiet stretches well before expiry collapse into one frame; everything near the action is per tick
  const mergeable = (r: TickRec) => quiet(r) && r.t < E - 3;
  let firstTriggerSeen = false;
  let i = 0;
  while (i < recs.length) {
    const r = recs[i];
    if (quiet(r)) {
      let j = i;
      if (mergeable(r)) while (j + 1 < recs.length && mergeable(recs[j + 1])) j++;
      for (let k = i; k <= j; k++) hist.push(recs[k].s);
      const n = j - i + 1;
      const next = recs[j + 1];
      const span = n === 1 ? `t=${r.t}` : `t=${r.t}–${recs[j].t}`;
      let caption = `${span}: all ${n * rps} requests HIT the cache. The DB sees 0 queries for this key.`;
      if (strategy === 'xfetch' && n === 1 && r.t === E) caption = `t=${E}: the original expiry passes unnoticed. All ${rps} requests HIT because the key was already refreshed early.`;
      let predict: string | undefined;
      if (next && !next.fresh && strategy !== 'xfetch') {
        predict = `The key ${strategy === 'swr' ? 'goes stale' : 'expires'} next tick while ${rps} requests/tick keep arriving and a recompute takes ${plural(D, 'tick')}. How many DB queries start before the first one finishes, and who waits?`;
      } else if (next && strategy === 'xfetch' && !next.fresh) {
        predict = `No early refresh has happened and the key expires next tick. What happens now?`;
      } else if (strategy === 'xfetch' && !next) {
        caption += ' The refreshed key is good for a long time, so the readers stay quiet.';
      }
      if (strategy === 'xfetch' && n > 1 && !firstTriggerSeen) caption += ` Expiry is ${E - recs[j].t} ticks away, so early-refresh odds are still small.`;
      push(i === 0 ? 0 : r.t, recs[j], caption, predict);
      i = j + 1;
      continue;
    }

    hist.push(r.s);
    totalDb += r.s.dbStarted;
    totalStale += r.s.stale;
    peak = Math.max(peak, r.s.dbInflight);
    const t = r.t;
    const s = r.s;
    let caption: string;
    let predict: string | undefined;
    if (strategy === 'xfetch' && r.fresh && s.dbStarted > 0) {
      caption = `t=${t}: ${r.triggers} reader${r.triggers > 1 ? 's' : ''} drew an early refresh ${plural(r.expiresAt - t, 'tick')} before expiry and recompute${r.triggers > 1 ? ' (no coordination, so duplicates happen)' : 's'}; ${r.triggers > 1 ? 'they wait' : 'only that reader waits'} ${plural(D, 'tick')}. The other ${s.hits} still HIT.`;
      if (!firstTriggerSeen) predict = `This recompute takes ${plural(D, 'tick')}. Do the other readers wait for it, and will the key ever actually expire?`;
      firstTriggerSeen = true;
    } else if (r.finished > 0 && r.fresh) {
      const lead =
        strategy === 'lock'
          ? `the single loader finished and wrote the value; all ${r.waitedSoFar} waiters are released at once with the fresh value`
          : strategy === 'swr'
            ? `the background refresh finished, so the key is fresh again and the soft TTL resets`
            : strategy === 'xfetch'
              ? `the early refresh landed, so expiry moves out to t=${r.expiresAt} and nobody ever saw a miss`
              : `the first recompute finished and refilled the cache, so new requests HIT`;
      caption = `t=${t}: ${lead}.${r.stillInflight ? ` ${plural(r.stillInflight, 'duplicate query is', 'duplicate queries are')} still running on the DB and will only overwrite the same value.` : ''}`;
    } else if (r.fresh) {
      caption = `t=${t}: all ${s.hits} requests HIT; ${r.stillInflight} recompute${r.stillInflight === 1 ? ' is' : 's are'} still running on the DB.`;
    } else if (strategy === 'none' || strategy === 'xfetch') {
      caption = `t=${t}: the key is gone, so all ${rps} requests MISS and each starts its own recompute. ${s.dbInflight} identical queries are now in flight (DB pool ≈ ${DB_POOL}), and each user waits ${plural(D, 'tick')}.`;
    } else if (strategy === 'lock') {
      caption =
        s.dbStarted > 0
          ? `t=${t}: key expired. Request #1 wins the lock (SET NX) and starts the only recompute; the other ${s.waits} wait on it. DB in flight: ${s.dbInflight}.`
          : `t=${t}: still loading. ${s.waits} more requests queue behind the lock (this tick's worst wait: ${plural(s.maxLatency, 'tick')}). DB in flight stays at ${s.dbInflight}.`;
    } else {
      caption =
        s.dbStarted > 0
          ? `t=${t}: soft TTL passed. All ${rps} requests get the STALE value instantly; the first also takes the refresh lock and starts one background refresh. DB in flight: 1.`
          : `t=${t}: the refresh is still running. ${rps} more requests are served stale with 0 wait, and no duplicate refresh starts.`;
    }
    const next = recs[i + 1];
    if (!predict && next && next.finished > 0 && !r.fresh) {
      predict =
        strategy === 'none' || strategy === 'xfetch'
          ? `The first recompute lands next tick. Do the other ${r.stillInflight - 1} in-flight queries stop?`
          : strategy === 'lock'
            ? `The loader finishes next tick. What happens to the ${r.waitedSoFar} waiting requests, and what was the worst wait?`
            : `The refresh lands next tick. How many users had to wait for it?`;
    }
    push(t, r, caption, predict);
    i++;
  }

  const last = frames[frames.length - 1];
  const worst = Math.max(0, ...recs.map((r) => r.s.maxLatency));
  const summary: Record<Strategy, string> = {
    none: `Summary: ${totalDb} identical DB queries (≈ ${rps} req/tick × ${D} ticks), and every miss waited ${plural(D, 'tick')}. Real DBs slow down past their pool, which stretches the recompute and grows the pile-up.`,
    lock: `Summary: 1 DB query, but ${waited} requests waited (worst ${plural(worst, 'tick')}). Waiters should await a promise or use a bounded wait, not poll Redis in a loop.`,
    swr: `Summary: 1 DB query and 0 waiting; ${totalStale} responses were up to ${plural(D, 'tick')} stale. Only use this where bounded staleness is acceptable.`,
    xfetch: `Summary: ${totalDb} DB quer${totalDb === 1 ? 'y' : 'ies'} and ${expiredMisses === 0 ? 'no reader ever saw a miss' : `${expiredMisses} misses, because nobody drew an early refresh in time`}. Without a lock, a few duplicate refreshes are possible.`,
  };
  last.caption = `${last.caption} ${summary[strategy]}`;
  return frames;
}
