// Pure, deterministic model of Netflix's Distributed Counter Abstraction (no React, Node-testable).
//   Best-effort counter: EVCache incr/decr, immediate but no idempotency (a retry double-counts).
//   Eventually consistent: AddCount writes an event (idempotency key = event_time + event_id) to the
//     TimeSeries event log, partitioned into time buckets, then fires a lightweight rollup event
//     (no delta) into an in-memory rollup queue. The rollup server aggregates only the IMMUTABLE window
//     [lastRollupTs, now − lag) where lag = acceptLimit + clock-skew margin, writes lastRollupCount/lastRollupTs and caches them. GetCount returns
//     the cached rollup (fast, maybe stale) and also triggers a rollup. The counter stays in rollup
//     circulation until lastRollupTs has caught up with its last write.
//   Accurate (experimental): GetCount = lastRollupCount + delta of events since lastRollupTs, computed
//     at read time by scanning the event log.
import type { BaseFrame } from '../../core';

export type Mode = 'best-effort' | 'eventual' | 'accurate';

export interface Params {
  mode: Mode;
  retry: 'on' | 'off';
  /** seconds the aggregation window trails now (acceptLimit + clock-skew margin) */
  lag: number;
}

export const DEFAULT_PARAMS: Params = { mode: 'eventual', retry: 'on', lag: 3 };

export const BUCKET_SECONDS = 4;
export const T_END = 17;

export interface Event {
  t: number;
  /** idempotency token (event_time + event_id) */
  tok: string;
  delta: number;
  bucket: number;
  rolled: boolean;
}

export type Action = 'write' | 'retry-dup' | 'retry-double' | 'lost-ack' | 'read' | 'rollup' | 'idle' | 'intro' | 'summary';

export interface Frame extends BaseFrame {
  t: number;
  mode: Mode;
  events: Event[];
  /** tokens rejected as duplicates by the event log */
  dupTokens: string[];
  truth: number;
  /** EVCache value of the best-effort counter */
  cacheValue: number;
  rollupCount: number;
  rollupTs: number;
  /** end of the window that is immutable now (now − lag) */
  windowEnd: number;
  queued: boolean;
  actions: Action[];
  read: { value: number; truth: number; scanned: number; base: number } | null;
  /** what GetCount would return at each past tick, for the chart */
  history: { t: number; truth: number; reported: number; cached: number }[];
}

interface Write {
  t: number;
  id: string;
  delta: number;
  /** the ack is lost: the client times out although the write was durable */
  ackLost?: boolean;
}

const WRITES: Write[] = [
  { t: 1, id: 'e1', delta: 1 },
  { t: 2, id: 'e2', delta: 1 },
  { t: 3, id: 'e3', delta: 1, ackLost: true },
  { t: 5, id: 'e4', delta: 2 },
  { t: 6, id: 'e5', delta: 1 },
  { t: 8, id: 'e6', delta: 1 },
  { t: 9, id: 'e7', delta: 1 },
];
export const READ_TIMES = [5, 7, 10, 13, 16];
export const LAST_WRITE = 9;

export function simulate({ mode, retry, lag }: Params): Frame[] {
  const frames: Frame[] = [];
  const events: Event[] = [];
  const dupTokens: string[] = [];
  let truth = 0;
  let cacheValue = 0;
  let rollupCount = 0;
  let rollupTs = 0;
  let lastWriteTs = -1;
  let queued = false;
  const history: Frame['history'] = [];
  const be = mode === 'best-effort';
  const tokOf = (w: Write) => `${w.t}s:${w.id}`;

  const sumSince = (from: number, to: number) => events.filter((e) => e.t >= from && e.t < to).reduce((a, e) => a + e.delta, 0);
  const reported = () => (be ? cacheValue : mode === 'accurate' ? rollupCount + sumSince(rollupTs, Infinity) : rollupCount);

  const modeTxt =
    mode === 'best-effort'
      ? 'Best-effort counter: AddCount is an EVCache incr in the local region. Fast and cheap, but no idempotency token and no cross-region replication.'
      : mode === 'eventual'
        ? `Eventually consistent counter: every AddCount is logged as an event in time buckets (toy ${BUCKET_SECONDS}s; Netflix's sample uses 600s); a rollup sums only the immutable window ending at now − ${lag}s (acceptLimit + skew), and GetCount returns the cached rollup.`
        : `Accurate counter (experimental): same event log and rollups, but GetCount adds the delta of events newer than the last rollup, computed at read time.`;
  frames.push({
    t: 0,
    mode,
    events: [],
    dupTokens: [],
    truth: 0,
    cacheValue: 0,
    rollupCount: 0,
    rollupTs: 0,
    windowEnd: 0,
    queued: false,
    actions: ['intro'],
    read: null,
    history: [],
    caption: `${modeTxt} Clients will add 8 views over 9 seconds; one client's ack is lost at t=3.`,
  });

  for (let t = 1; t <= T_END; t++) {
    const actions: Action[] = [];
    const notes: string[] = [];
    let predict: string | undefined;
    let read: Frame['read'] = null;

    // writes at t
    for (const w of WRITES.filter((x) => x.t === t)) {
      truth += w.delta;
      lastWriteTs = t;
      if (be) {
        cacheValue += w.delta;
        notes.push(`AddCount(+${w.delta}) → EVCache incr: value ${cacheValue}.`);
      } else {
        events.push({ t, tok: tokOf(w), delta: w.delta, bucket: Math.floor(t / BUCKET_SECONDS), rolled: false });
        queued = true;
        notes.push(`AddCount(+${w.delta}, token ${tokOf(w)}) is written durably to bucket ${Math.floor(t / BUCKET_SECONDS)} and a rollup event (no delta) is queued.`);
      }
      actions.push('write');
      if (w.ackLost) {
        actions.push('lost-ack');
        notes.push(`The write succeeded but its ack is lost, so the client times out${retry === 'on' ? ' and will retry with the SAME token.' : ' and gives up.'}`);
        if (retry === 'on')
          predict = be
            ? 'The client retries the same +1. EVCache incr has no idempotency token. What happens to the count?'
            : 'The client retries the same +1 with the same idempotency token. Will the count go up twice?';
      }
    }
    // retry of the lost ack, one second later
    const lost = WRITES.find((w) => w.ackLost && w.t + 1 === t);
    if (lost && retry === 'on') {
      if (be) {
        cacheValue += lost.delta;
        actions.push('retry-double');
        notes.unshift(`Retry of the t=${lost.t} request: EVCache simply increments again → ${cacheValue}, but only ${truth} views happened. Over-count by ${cacheValue - truth}.`);
      } else {
        dupTokens.push(tokOf(lost));
        queued = true;
        actions.push('retry-dup');
        notes.unshift(`Retry of t=${lost.t} with token ${tokOf(lost)}: the event log already has that idempotency key, so it is an overwrite of the same event, not a new one. No over-count.`);
      }
    }

    // reads at t (GetCount): returns the cached rollup and triggers a rollup
    if (READ_TIMES.includes(t)) {
      actions.push('read');
      if (be) {
        read = { value: cacheValue, truth, scanned: 0, base: cacheValue };
        notes.push(`GetCount → ${cacheValue} straight from EVCache${cacheValue !== truth ? ` (truth ${truth}: the retry double-counted)` : ' (exact, for now)'}.`);
      } else if (mode === 'eventual') {
        read = { value: rollupCount, truth, scanned: 0, base: rollupCount };
        notes.push(
          `GetCount → ${rollupCount}, the cached last rollup (covers events before t=${rollupTs})${rollupCount !== truth ? `; truth is ${truth}, so the read is stale by ${truth - rollupCount}` : ', which equals the truth'}. The read also triggers a rollup.`,
        );
        queued = true;
      } else {
        const fresh = events.filter((e) => e.t >= rollupTs);
        const buckets = new Set(fresh.map((e) => e.bucket)).size;
        const value = rollupCount + sumSince(rollupTs, Infinity);
        read = { value, truth, scanned: fresh.length, base: rollupCount };
        notes.push(
          `GetCount → ${rollupCount} (events before t=${rollupTs}) + ${value - rollupCount} delta = ${value}, exact, but it scanned ${fresh.length} event${fresh.length === 1 ? '' : 's'} in ${buckets} bucket${buckets === 1 ? '' : 's'} at read time.`,
        );
        queued = true;
      }
    }

    // rollup server: aggregate the immutable window [rollupTs, t − lag)
    const windowEnd = Math.max(0, t - lag);
    if (!be && queued && windowEnd > rollupTs) {
      const add = events.filter((e) => e.t >= rollupTs && e.t < windowEnd);
      const sum = add.reduce((a, e) => a + e.delta, 0);
      add.forEach((e) => (e.rolled = true));
      const prevTs = rollupTs;
      rollupCount += sum;
      rollupTs = windowEnd;
      actions.push('rollup');
      notes.push(
        sum
          ? `Rollup sums the immutable window [${prevTs}s, ${windowEnd}s): +${sum} → checkpoint {count ${rollupCount}, lastRollupTs ${windowEnd}} cached in EVCache as one value.`
          : `Rollup advances lastRollupTs to ${windowEnd} (no new events in that window).`,
      );
      // stays in circulation until the rollup has caught up with the last write
      queued = rollupTs <= lastWriteTs;
      if (!queued && lastWriteTs >= 0 && prevTs <= lastWriteTs) notes.push(`lastRollupTs is past the last write (t=${lastWriteTs}): the counter leaves rollup circulation.`);
    } else if (!be && queued && notes.length === 0) {
      notes.push(`Rollup waits: events stamped after now − ${lag}s = ${windowEnd}s may still arrive (within acceptLimit + skew), so that window is not immutable yet.`);
    }
    if (!actions.length) actions.push('idle');
    if (notes.length === 0) notes.push(be ? `No traffic. EVCache still holds ${cacheValue}.` : `No traffic. lastRollupCount ${rollupCount} at lastRollupTs ${rollupTs}.`);

    if (!predict && t === READ_TIMES[0] - 1)
      predict = be
        ? `Next second a +2 arrives and then a GetCount. What will EVCache return, and does it match the ${truth + 2} views that really happened?`
        : mode === 'eventual'
          ? `Next second a +2 arrives and then a GetCount. ${truth + 2} views will have happened. What will the read return with a ${lag}s window lag?`
          : `Next second a +2 arrives and then a GetCount. The last rollup covers only events before t=${rollupTs}. How can the read still be exact?`;
    // predict before convergence (eventual mode): at the last write
    if (!predict && t === LAST_WRITE && mode === 'eventual')
      predict = `Writes stop now at ${truth} views. With a ${lag}s window lag, when will the cached rollup (what GetCount returns) reach ${truth}?`;
    if (!predict && t === LAST_WRITE && mode === 'accurate') predict = `Writes stop now. Accurate reads are already exact. What do they pay for that, compared with the eventual counter?`;
    if (!predict && t === LAST_WRITE && mode === 'best-effort')
      predict = `Writes stop now. EVCache reads are instant. Will the count ever correct itself to the true ${truth}?`;

    history.push({ t, truth, reported: read ? read.value : reported(), cached: reported() });
    frames.push({
      t,
      mode,
      events: events.map((e) => ({ ...e })),
      dupTokens: [...dupTokens],
      truth,
      cacheValue,
      rollupCount,
      rollupTs,
      windowEnd,
      queued,
      actions,
      read,
      history: history.map((h) => ({ ...h })),
      caption: `t=${t}s: ${notes.join(' ')}`,
      predict,
    });
  }

  const conv = history.find((h) => h.t >= LAST_WRITE && h.cached === h.truth)?.t;
  const firstGood = READ_TIMES.find((rt) => conv !== undefined && rt > conv);
  const final = history[history.length - 1];
  frames.push({
    ...frames[frames.length - 1],
    actions: ['summary'],
    read: null,
    predict: undefined,
    caption: be
      ? `Result: EVCache says ${final.reported}, truth is ${final.truth}${final.reported !== final.truth ? ': the double-counted retry is permanent, since there is nothing to reconcile against' : ''}. Best-effort is right for short-lived A/B-test counts, not for anything billed or audited.`
      : mode === 'eventual'
        ? `Result: the cached rollup reached ${final.truth} at t=${conv}s, ${conv! - LAST_WRITE}s after the last write: only once now − ${lag}s had passed t=${LAST_WRITE} was that event's window immutable and rolled up${firstGood ? `; the next read (t=${firstGood}s) returned it` : ''}. ${retry === 'on' ? 'The retry was absorbed by its idempotency token, and reads' : 'Reads'} stayed a cheap point lookup of the cached rollup.`
        : `Result: every read was exact, including mid-burst, at the cost of scanning recent events on each GetCount. Frequently read counters keep that delta small; rarely read ones pay a bigger scan.`,
  });
  return frames;
}
