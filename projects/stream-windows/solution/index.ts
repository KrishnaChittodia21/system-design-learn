// Reference solution: a keyed, event-time windowed aggregator with watermarks.
//
// Concepts (Flink / Beam / Kafka Streams vocabulary):
//   event time      — the timestamp inside the event, not when it arrived
//   watermark       — "no more events older than this are expected": max event time − outOfOrdernessMs
//   window fires    — when watermark ≥ window.end, emit the result (revision 0)
//   allowed lateness— window state is kept until watermark ≥ end + allowedLatenessMs; a late event
//                     in that span updates the result and re-emits it (revision 1, 2, …)
//   too late        — after that the event is dropped (or sent to a side output)
// Downstream consumers upsert results by (key, window) and keep the highest revision, which
// makes re-emission idempotent.

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
 * tumbling starts are multiples of size; sliding starts are multiples of slide.
 */
export function assignWindows(ts: number, spec: WindowSpec): Window[] {
  validateSpec(spec);
  if (spec.kind === 'tumbling') {
    const start = Math.floor(ts / spec.size) * spec.size;
    return [{ start, end: start + spec.size }];
  }
  const out: Window[] = [];
  for (let s = Math.floor(ts / spec.slide) * spec.slide; s > ts - spec.size; s -= spec.slide) {
    out.push({ start: s, end: s + spec.size });
  }
  return out.reverse();
}

function validateSpec(spec: WindowSpec): void {
  if (!(spec.size > 0)) throw new Error('window size must be > 0');
  if (spec.kind === 'sliding' && !(spec.slide > 0)) throw new Error('slide must be > 0');
}

/** An incremental (associative-friendly) aggregation. */
export interface Aggregator<V, A, R> {
  create(): A;
  add(acc: A, value: V): A;
  result(acc: A): R;
}

export const sum: Aggregator<number, number, number> = { create: () => 0, add: (a, v) => a + v, result: (a) => a };
export const count: Aggregator<unknown, number, number> = { create: () => 0, add: (a) => a + 1, result: (a) => a };
export const max: Aggregator<number, number, number> = { create: () => -Infinity, add: (a, v) => Math.max(a, v), result: (a) => a };
export const avg: Aggregator<number, { sum: number; n: number }, number> = {
  create: () => ({ sum: 0, n: 0 }),
  add: (a, v) => ({ sum: a.sum + v, n: a.n + 1 }),
  result: (a) => (a.n === 0 ? 0 : a.sum / a.n),
};

export interface WindowResult<R> {
  key: string;
  window: Window;
  value: R;
  /** number of events aggregated into this result */
  count: number;
  /** 0 for the on-time firing; +1 for each late update */
  revision: number;
}

export interface WindowedAggregatorOptions<V, A, R> {
  window: WindowSpec;
  aggregator: Aggregator<V, A, R>;
  /** watermark = max event time seen − outOfOrdernessMs (default 0) */
  outOfOrdernessMs?: number;
  /** keep window state this long after it fires so late events can update it (default 0) */
  allowedLatenessMs?: number;
  /** what to do with events that are too late for every window they belong to (default 'drop') */
  lateEvents?: 'drop' | 'side-output';
}

interface WindowState<A> {
  key: string;
  window: Window;
  acc: A;
  count: number;
  fired: boolean;
  revision: number;
  ids: Set<string>;
}

export class WindowedAggregator<V, A, R> {
  #spec: WindowSpec;
  #agg: Aggregator<V, A, R>;
  #ooo: number;
  #lateness: number;
  #policy: 'drop' | 'side-output';
  #wm = -Infinity;
  /** `${key}\u0000${start}` → state */
  #state = new Map<string, WindowState<A>>();
  #side: StreamEvent<V>[] = [];
  #late = 0;

  constructor(opts: WindowedAggregatorOptions<V, A, R>) {
    validateSpec(opts.window);
    this.#spec = opts.window;
    this.#agg = opts.aggregator;
    this.#ooo = opts.outOfOrdernessMs ?? 0;
    this.#lateness = opts.allowedLatenessMs ?? 0;
    this.#policy = opts.lateEvents ?? 'drop';
    if (this.#ooo < 0 || this.#lateness < 0) throw new Error('lateness values must be ≥ 0');
  }

  get watermark(): number {
    return this.#wm;
  }

  /** Events that were too late for all of their windows. */
  get lateCount(): number {
    return this.#late;
  }

  /** Copies of the too-late events (only collected with lateEvents: 'side-output'). */
  sideOutput(): StreamEvent<V>[] {
    return this.#side.map((e) => ({ ...e }));
  }

  /** Number of (key, window) states currently held in memory. */
  openWindows(): number {
    return this.#state.size;
  }

  /**
   * Ingest one event. Returns, in order: immediate late updates caused by this event, then
   * every window that fires because the watermark advanced.
   */
  process(e: StreamEvent<V>): WindowResult<R>[] {
    const out: WindowResult<R>[] = [];
    const windows = assignWindows(e.timestamp, this.#spec);
    let accepted = 0;
    let expired = 0;
    for (const w of windows) {
      if (w.end + this.#lateness <= this.#wm) {
        expired++; // state is gone (or would be): too late for this window
        continue;
      }
      const k = `${e.key}\u0000${w.start}`;
      let st = this.#state.get(k);
      if (!st) {
        st = { key: e.key, window: w, acc: this.#agg.create(), count: 0, fired: false, revision: 0, ids: new Set() };
        this.#state.set(k, st);
      }
      if (e.id !== undefined) {
        if (st.ids.has(e.id)) {
          accepted++; // a duplicate is not late; it's just a no-op
          continue;
        }
        st.ids.add(e.id);
      }
      st.acc = this.#agg.add(st.acc, e.value);
      st.count++;
      accepted++;
      // The watermark already passed this window: emit now (a late update, or a first firing).
      if (w.end <= this.#wm) {
        if (st.fired) st.revision++;
        st.fired = true;
        out.push(this.#result(st));
      }
    }
    if (windows.length > 0 && expired === windows.length && accepted === 0) {
      this.#late++;
      if (this.#policy === 'side-output') this.#side.push({ ...e });
    }
    const candidate = e.timestamp - this.#ooo;
    if (candidate > this.#wm) out.push(...this.#advance(candidate));
    return out;
  }

  /** Explicit watermark (e.g. from an idle source or a punctuation). Lower values are ignored. */
  advanceWatermark(wm: number): WindowResult<R>[] {
    return wm > this.#wm ? this.#advance(wm) : [];
  }

  /** End of input: fire every open window that has not fired yet, then drop all state. */
  flush(): WindowResult<R>[] {
    return this.#advance(Infinity);
  }

  #advance(wm: number): WindowResult<R>[] {
    this.#wm = wm;
    const due = [...this.#state.values()]
      .filter((s) => !s.fired && s.window.end <= wm)
      .sort((a, b) => a.window.end - b.window.end || a.window.start - b.window.start || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const out: WindowResult<R>[] = [];
    for (const s of due) {
      s.fired = true;
      out.push(this.#result(s));
    }
    for (const [k, s] of this.#state) if (s.window.end + this.#lateness <= wm) this.#state.delete(k);
    return out;
  }

  #result(s: WindowState<A>): WindowResult<R> {
    return { key: s.key, window: { ...s.window }, value: this.#agg.result(s.acc), count: s.count, revision: s.revision };
  }
}

/**
 * An idempotent sink: an upsert table keyed by (key, window.start) that keeps the highest
 * revision. Replays and out-of-order deliveries of results are harmless.
 */
export class ResultTable<R> {
  #rows = new Map<string, WindowResult<R>>();

  /** Returns true if the row changed. */
  apply(r: WindowResult<R>): boolean {
    const k = `${r.key}\u0000${r.window.start}`;
    const cur = this.#rows.get(k);
    if (cur && cur.revision >= r.revision) return false;
    this.#rows.set(k, r);
    return true;
  }

  get(key: string, windowStart: number): WindowResult<R> | undefined {
    return this.#rows.get(`${key}\u0000${windowStart}`);
  }

  /** All rows sorted by window start, then key. */
  rows(): WindowResult<R>[] {
    return [...this.#rows.values()].sort((a, b) => a.window.start - b.window.start || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
}
