// Reference solution: a stampede-proof cache loader.
// single-flight per key · stale-while-revalidate (soft/hard TTL) · negative caching ·
// errors never poison the cache · global concurrency limit for loader calls · invalidation races.

export type Loader<V> = (key: string) => Promise<V | undefined>;

export interface LoaderCacheOptions<V> {
  /** fetches the value from the slow source; resolve `undefined` for "does not exist" */
  loader: Loader<V>;
  /** soft TTL: a value younger than this is fresh and served without any load */
  freshMs: number;
  /** extra window after freshMs during which the stale value is served while ONE background refresh runs (default 0) */
  staleMs?: number;
  /** how long an "undefined" result is cached (default 0 = not cached) */
  negativeTtlMs?: number;
  /** max loader calls running at once across all keys; the rest wait FIFO (default Infinity) */
  maxConcurrentLoads?: number;
  now?: () => number;
  /** called when a background refresh fails (the stale value is kept) */
  onError?: (key: string, error: unknown) => void;
}

export type EntryState = 'fresh' | 'stale' | 'negative';

interface Entry<V> {
  value: V | undefined;
  loadedAt: number;
  negative: boolean;
}

interface Flight<V> {
  promise: Promise<V | undefined>;
  generation: number;
}

export class LoaderCache<V> {
  #loader: Loader<V>;
  #freshMs: number;
  #staleMs: number;
  #negativeMs: number;
  #maxLoads: number;
  #now: () => number;
  #onError: (key: string, error: unknown) => void;
  #entries = new Map<string, Entry<V>>();
  #flights = new Map<string, Flight<V>>();
  /** bumped by invalidate(): loads started under an older generation must not write */
  #generations = new Map<string, number>();
  #active = 0;
  #queue: Array<() => void> = [];

  constructor(options: LoaderCacheOptions<V>) {
    if (!(options.freshMs >= 0)) throw new RangeError('freshMs must be >= 0');
    const max = options.maxConcurrentLoads ?? Infinity;
    if (!(max >= 1)) throw new RangeError('maxConcurrentLoads must be >= 1');
    this.#loader = options.loader;
    this.#freshMs = options.freshMs;
    this.#staleMs = options.staleMs ?? 0;
    this.#negativeMs = options.negativeTtlMs ?? 0;
    this.#maxLoads = max;
    this.#now = options.now ?? Date.now;
    this.#onError = options.onError ?? (() => {});
  }

  /** Keys with a load in flight. */
  get inflight(): number {
    return this.#flights.size;
  }
  /** Loader calls currently running. */
  get activeLoads(): number {
    return this.#active;
  }
  /** Loads waiting for a concurrency slot. */
  get queuedLoads(): number {
    return this.#queue.length;
  }

  /**
   * fresh → cached value; stale → cached value now + one background refresh;
   * negative (within negativeTtlMs) → undefined; otherwise join or start the single flight.
   */
  get(key: string): Promise<V | undefined> {
    const e = this.#entries.get(key);
    if (e) {
      const state = this.#state(e);
      if (state === 'fresh' || state === 'negative') return Promise.resolve(e.value);
      if (state === 'stale') {
        if (!this.#flights.has(key)) {
          // background refresh: errors are reported, never thrown at anyone, never stored
          this.#load(key).catch((err) => this.#onError(key, err));
        }
        return Promise.resolve(e.value);
      }
    }
    return this.#flights.get(key)?.promise ?? this.#load(key);
  }

  /** Inspect without loading. */
  peek(key: string): { value: V | undefined; state: EntryState } | undefined {
    const e = this.#entries.get(key);
    if (!e) return undefined;
    const state = this.#state(e);
    return state === 'expired' ? undefined : { value: e.value, state };
  }

  /** Drop the entry; an in-flight load for this key will still answer its waiters but will not be stored. */
  invalidate(key: string): void {
    this.#entries.delete(key);
    this.#flights.delete(key);
    this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
  }

  #state(e: Entry<V>): EntryState | 'expired' {
    const age = this.#now() - e.loadedAt;
    if (e.negative) return age < this.#negativeMs ? 'negative' : 'expired';
    if (age < this.#freshMs) return 'fresh';
    if (age < this.#freshMs + this.#staleMs) return 'stale';
    return 'expired';
  }

  #load(key: string): Promise<V | undefined> {
    const generation = this.#generations.get(key) ?? 0;
    const promise = this.#withSlot(() => this.#loader(key)).then(
      (value) => {
        // only the latest generation may write: an invalidate() during the load wins
        if ((this.#generations.get(key) ?? 0) === generation) {
          if (value === undefined) {
            if (this.#negativeMs > 0) this.#entries.set(key, { value, loadedAt: this.#now(), negative: true });
            else this.#entries.delete(key);
          } else {
            this.#entries.set(key, { value, loadedAt: this.#now(), negative: false });
          }
        }
        return value;
      },
    );
    const flight: Flight<V> = { promise, generation };
    this.#flights.set(key, flight);
    // clear the flight whatever happens — a failed load must not be shared by future callers
    const done = () => {
      if (this.#flights.get(key) === flight) this.#flights.delete(key);
    };
    promise.then(done, done);
    return promise;
  }

  /** Semaphore: run `fn` when a slot is free; FIFO waiters. */
  async #withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#maxLoads) await new Promise<void>((resolve) => this.#queue.push(resolve));
    else this.#active++;
    try {
      return await fn();
    } finally {
      const next = this.#queue.shift();
      if (next) next(); // hand the slot over directly: #active stays the same
      else this.#active--;
    }
  }
}
