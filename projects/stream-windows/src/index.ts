// STARTER — a keyed, event-time windowed aggregator with watermarks.
// Implement every function/method below. Run the judge with:  npm run project -- stream-windows
// Keep the exported names and signatures: the tests import them.
//
// Vocabulary (Flink / Beam / Kafka Streams):
//   event time       — the timestamp inside the event, not when it arrived
//   watermark        — max event time seen − outOfOrdernessMs ("nothing older is expected")
//   window fires     — when watermark ≥ window.end: emit the result with revision 0
//   allowed lateness — keep window state until watermark ≥ end + allowedLatenessMs; a late event
//                      in that span updates the result and re-emits it (revision 1, 2, …)
//   too late         — after that, the event is dropped (or sent to a side output)

export interface StreamEvent<V> {
  key: string;
  value: V;
  /** event time, ms */
  timestamp: number;
  /** optional unique id; duplicates (at-least-once sources) are ignored per window */
  id?: string;
}

export type WindowSpec = { kind: 'tumbling'; size: number } | { kind: 'sliding'; size: number; slide: number };

/** Half-open interval [start, end). */
export interface Window {
  start: number;
  end: number;
}

/**
 * Windows containing `ts`, ascending by start. Windows are aligned to epoch 0:
 * tumbling starts are multiples of `size` (use Math.floor so negatives work);
 * sliding starts are multiples of `slide` with start ≤ ts < start + size.
 * If slide > size there are gaps, and some timestamps belong to no window ([]).
 * Throws if size ≤ 0 or slide ≤ 0.
 */
export function assignWindows(ts: number, spec: WindowSpec): Window[] {
  throw new Error('Not implemented: assignWindows');
}

/** An incremental aggregation. */
export interface Aggregator<V, A, R> {
  create(): A;
  add(acc: A, value: V): A;
  result(acc: A): R;
}

/** Sum of values. */
export const sum: Aggregator<number, number, number> = {
  create: () => { throw new Error('Not implemented: sum.create'); },
  add: () => { throw new Error('Not implemented: sum.add'); },
  result: () => { throw new Error('Not implemented: sum.result'); },
};

/** Number of values. */
export const count: Aggregator<unknown, number, number> = {
  create: () => { throw new Error('Not implemented: count.create'); },
  add: () => { throw new Error('Not implemented: count.add'); },
  result: () => { throw new Error('Not implemented: count.result'); },
};

/** Maximum value (-Infinity when empty). */
export const max: Aggregator<number, number, number> = {
  create: () => { throw new Error('Not implemented: max.create'); },
  add: () => { throw new Error('Not implemented: max.add'); },
  result: () => { throw new Error('Not implemented: max.result'); },
};

/** Mean value (0 when empty). Keep {sum, n} as the accumulator. */
export const avg: Aggregator<number, { sum: number; n: number }, number> = {
  create: () => { throw new Error('Not implemented: avg.create'); },
  add: () => { throw new Error('Not implemented: avg.add'); },
  result: () => { throw new Error('Not implemented: avg.result'); },
};

export interface WindowResult<R> {
  key: string;
  window: Window;
  value: R;
  /** number of events aggregated into this result */
  count: number;
  /** 0 for the first firing; +1 for each late update */
  revision: number;
}

export interface WindowedAggregatorOptions<V, A, R> {
  window: WindowSpec;
  aggregator: Aggregator<V, A, R>;
  /** watermark = max event time seen − outOfOrdernessMs (default 0) */
  outOfOrdernessMs?: number;
  /** keep window state this long after it fires so late events can update it (default 0) */
  allowedLatenessMs?: number;
  /** what to do with events that are too late for EVERY window they belong to (default 'drop') */
  lateEvents?: 'drop' | 'side-output';
}

/**
 * Keyed windowed aggregation on event time. Rules for process(e):
 * 1. For each window w of e (per key): if w.end + allowedLateness ≤ watermark, the window is
 *    gone — skip it. Otherwise add e to the (key, w) state (unless e.id was already added
 *    to that window: duplicates are a no-op, not late). If w.end ≤ watermark, emit the
 *    window immediately (revision + 1 if it had fired before, else 0).
 * 2. If e had ≥ 1 window and was skipped by all of them, it is too late: lateCount++ and,
 *    with 'side-output', keep a copy.
 * 3. Raise the watermark to e.timestamp − outOfOrdernessMs if that is higher. Then fire every
 *    unfired window with end ≤ watermark, sorted by (end, start, key), and purge states
 *    with end + allowedLateness ≤ watermark.
 * Return the emissions of step 1 followed by those of step 3.
 */
export class WindowedAggregator<V, A, R> {
  /** Throws on an invalid window spec or negative lateness values. */
  constructor(opts: WindowedAggregatorOptions<V, A, R>) {
    throw new Error('Not implemented: WindowedAggregator.constructor');
  }

  /** Current watermark; -Infinity before the first event. */
  get watermark(): number {
    throw new Error('Not implemented: WindowedAggregator.watermark');
  }

  /** Number of events that were too late for all of their windows. */
  get lateCount(): number {
    throw new Error('Not implemented: WindowedAggregator.lateCount');
  }

  /** Copies of the too-late events, in arrival order (only collected with lateEvents: 'side-output'). */
  sideOutput(): StreamEvent<V>[] {
    throw new Error('Not implemented: WindowedAggregator.sideOutput');
  }

  /** Number of (key, window) states currently held in memory. */
  openWindows(): number {
    throw new Error('Not implemented: WindowedAggregator.openWindows');
  }

  /** Ingest one event (see the class doc). */
  process(e: StreamEvent<V>): WindowResult<R>[] {
    throw new Error('Not implemented: WindowedAggregator.process');
  }

  /** Explicit watermark (idle source / punctuation): step 3 with this watermark. Lower values are ignored ([]). */
  advanceWatermark(wm: number): WindowResult<R>[] {
    throw new Error('Not implemented: WindowedAggregator.advanceWatermark');
  }

  /** End of input: advance the watermark to Infinity (fires everything, purges all state). */
  flush(): WindowResult<R>[] {
    throw new Error('Not implemented: WindowedAggregator.flush');
  }
}

/**
 * An idempotent sink: an upsert table keyed by (key, window.start) that keeps the row with
 * the highest revision. Replays and out-of-order deliveries of results are harmless.
 */
export class ResultTable<R> {
  /** Upsert; returns true if the row changed (new key or strictly higher revision). */
  apply(r: WindowResult<R>): boolean {
    throw new Error('Not implemented: ResultTable.apply');
  }

  get(key: string, windowStart: number): WindowResult<R> | undefined {
    throw new Error('Not implemented: ResultTable.get');
  }

  /** All rows sorted by window start, then key. */
  rows(): WindowResult<R>[] {
    throw new Error('Not implemented: ResultTable.rows');
  }
}
