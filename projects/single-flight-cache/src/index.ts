// STARTER — implement every method. Run: npm run project -- single-flight-cache
// Erasable TypeScript only (no enums / parameter properties / namespaces). Use the injected `now`.

export type Loader<V> = (key: string) => Promise<V | undefined>;

export interface LoaderCacheOptions<V> {
  /** fetches the value from the slow source; resolves `undefined` for "does not exist" */
  loader: Loader<V>;
  /** soft TTL: a value whose age (now - loadedAt) is < freshMs is fresh and served without any load */
  freshMs: number;
  /** extra window [freshMs, freshMs + staleMs) during which the stale value is served while ONE background refresh runs (default 0) */
  staleMs?: number;
  /** how long an `undefined` result is cached (age < negativeTtlMs); default 0 = not cached */
  negativeTtlMs?: number;
  /** max loader calls running at once across ALL keys; extra loads wait FIFO (default Infinity; < 1 → RangeError) */
  maxConcurrentLoads?: number;
  /** clock in ms (default Date.now); loadedAt is taken when a load COMPLETES */
  now?: () => number;
  /** called when a background (stale-while-revalidate) refresh fails — the stale value is kept */
  onError?: (key: string, error: unknown) => void;
}

export type EntryState = 'fresh' | 'stale' | 'negative';

export class LoaderCache<V> {
  /** @throws RangeError for freshMs < 0 or maxConcurrentLoads < 1 */
  constructor(options: LoaderCacheOptions<V>) {
    throw new Error('Not implemented: LoaderCache.constructor');
  }
  /** Number of keys with a load in flight. */
  get inflight(): number {
    throw new Error('Not implemented: LoaderCache.inflight');
  }
  /** Loader calls currently running (never above maxConcurrentLoads). */
  get activeLoads(): number {
    throw new Error('Not implemented: LoaderCache.activeLoads');
  }
  /** Loads waiting for a concurrency slot. */
  get queuedLoads(): number {
    throw new Error('Not implemented: LoaderCache.queuedLoads');
  }
  /**
   * - fresh entry → its value, no load
   * - stale entry → its value immediately + start ONE background refresh (unless one is already in flight);
   *   a failed refresh calls onError, keeps the stale value and must not cause an unhandled rejection
   * - negative entry (still within negativeTtlMs) → undefined, no load
   * - otherwise (missing / past the hard TTL) → join the key's in-flight load or start one (single-flight).
   *   All joiners get the same result or the same rejection. A failed load is NOT cached:
   *   the next get() calls the loader again.
   */
  get(key: string): Promise<V | undefined> {
    throw new Error('Not implemented: LoaderCache.get');
  }
  /** Inspect without loading: { value, state } for a fresh/stale/negative entry, undefined if missing or expired. */
  peek(key: string): { value: V | undefined; state: EntryState } | undefined {
    throw new Error('Not implemented: LoaderCache.peek');
  }
  /**
   * Drop the entry. The next get() starts a NEW load (it does not join the old one). A load that was
   * already in flight still answers its own waiters, but its result must NOT be stored (it may be stale).
   */
  invalidate(key: string): void {
    throw new Error('Not implemented: LoaderCache.invalidate');
  }
}
