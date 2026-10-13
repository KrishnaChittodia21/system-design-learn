// Reference solution: a pluggable rate-limiting library.
// Strategies (token bucket, sliding-window counter) share one interface; a RateLimiter
// combines several rules and charges either all of them or none.

/** Result of checking / consuming against one rule (or the combined limiter). */
export interface Decision {
  allowed: boolean;
  /** whole units still available after this request (0 when denied) */
  remaining: number;
  /** ms until a request of the same cost could succeed; 0 when allowed; Infinity when it never can */
  retryAfterMs: number;
}

/** Every algorithm implements this, so the limiter doesn't care which it is. */
export interface RateLimitStrategy {
  /** Human-readable rule name, reported in `deniedBy`. */
  readonly name: string;
  /** Number of keys currently holding state. */
  readonly size: number;
  /** Evaluate a request of `cost` units for `key` WITHOUT charging it (and without creating state). */
  check(key: string, cost?: number): Decision;
  /** Charge `cost` units if (and only if) allowed. */
  consume(key: string, cost?: number): Decision;
  /** Forget a key. */
  reset(key: string): void;
  /** Drop every key whose state is indistinguishable from a fresh key; returns how many were dropped. */
  sweep(): number;
}

export interface TokenBucketOptions {
  name?: string;
  /** maximum tokens (burst size), > 0 */
  capacity: number;
  /** tokens added per second, > 0 */
  refillPerSecond: number;
  now?: () => number;
  /** memory bound: when a NEW key would exceed this, evict the least-recently-used key */
  maxKeys?: number;
}

const EPS = 1e-9;

function ceilMs(x: number): number {
  return Math.max(0, Math.ceil(x - EPS));
}

function checkCost(cost: number): void {
  if (!(cost > 0) || !Number.isFinite(cost)) throw new RangeError('cost must be a positive number');
}

/** Map with LRU touch + bounded size. Map insertion order is fine here: it's a memory bound, not the lesson. */
class BoundedMap<V> {
  #map = new Map<string, V>();
  #max: number;
  constructor(max: number) {
    this.#max = max;
  }
  get size(): number {
    return this.#map.size;
  }
  peek(key: string): V | undefined {
    return this.#map.get(key);
  }
  put(key: string, value: V): void {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.#max) {
      const oldest = this.#map.keys().next().value as string;
      this.#map.delete(oldest);
    }
  }
  delete(key: string): void {
    this.#map.delete(key);
  }
  entries(): IterableIterator<[string, V]> {
    return this.#map.entries();
  }
}

interface BucketState {
  tokens: number;
  updatedAt: number;
}

export class TokenBucket implements RateLimitStrategy {
  readonly name: string;
  #capacity: number;
  #ratePerMs: number;
  #now: () => number;
  #state: BoundedMap<BucketState>;

  constructor(options: TokenBucketOptions) {
    if (!(options.capacity > 0) || !(options.refillPerSecond > 0)) {
      throw new RangeError('capacity and refillPerSecond must be > 0');
    }
    this.name = options.name ?? 'token-bucket';
    this.#capacity = options.capacity;
    this.#ratePerMs = options.refillPerSecond / 1000;
    this.#now = options.now ?? Date.now;
    this.#state = new BoundedMap(options.maxKeys ?? Infinity);
  }

  get size(): number {
    return this.#state.size;
  }

  check(key: string, cost = 1): Decision {
    checkCost(cost);
    return this.#decide(this.#tokens(key), cost);
  }

  consume(key: string, cost = 1): Decision {
    checkCost(cost);
    const tokens = this.#tokens(key);
    const d = this.#decide(tokens, cost);
    // persist the refilled level either way; charge only when allowed
    this.#state.put(key, { tokens: d.allowed ? tokens - cost : tokens, updatedAt: this.#now() });
    return d;
  }

  reset(key: string): void {
    this.#state.delete(key);
  }

  sweep(): number {
    const now = this.#now();
    const idle: string[] = [];
    for (const [k, s] of this.#state.entries()) {
      if (this.#refill(s, now) >= this.#capacity - EPS) idle.push(k);
    }
    for (const k of idle) this.#state.delete(k);
    return idle.length;
  }

  #refill(s: BucketState, now: number): number {
    return Math.min(this.#capacity, s.tokens + Math.max(0, now - s.updatedAt) * this.#ratePerMs);
  }

  #tokens(key: string): number {
    const s = this.#state.peek(key);
    return s ? this.#refill(s, this.#now()) : this.#capacity;
  }

  #decide(tokens: number, cost: number): Decision {
    if (tokens + EPS >= cost) {
      return { allowed: true, remaining: Math.floor(tokens - cost + EPS), retryAfterMs: 0 };
    }
    const retryAfterMs = cost > this.#capacity ? Infinity : ceilMs((cost - tokens) / this.#ratePerMs);
    return { allowed: false, remaining: 0, retryAfterMs };
  }
}

export interface SlidingWindowOptions {
  name?: string;
  /** max units per window, > 0 */
  limit: number;
  /** window length in ms, > 0 */
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}

interface WindowState {
  /** index of the current fixed window = floor(now / windowMs) */
  window: number;
  curr: number;
  prev: number;
}

/**
 * Sliding-window counter (the Cloudflare approximation): keep counts for the current and
 * previous fixed windows and weight the previous one by how much of it still overlaps.
 *   estimate = prev * (1 - elapsedInCurrent / windowMs) + curr
 */
export class SlidingWindowCounter implements RateLimitStrategy {
  readonly name: string;
  #limit: number;
  #windowMs: number;
  #now: () => number;
  #state: BoundedMap<WindowState>;

  constructor(options: SlidingWindowOptions) {
    if (!(options.limit > 0) || !(options.windowMs > 0)) throw new RangeError('limit and windowMs must be > 0');
    this.name = options.name ?? 'sliding-window';
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#now = options.now ?? Date.now;
    this.#state = new BoundedMap(options.maxKeys ?? Infinity);
  }

  get size(): number {
    return this.#state.size;
  }

  check(key: string, cost = 1): Decision {
    checkCost(cost);
    return this.#decide(this.#current(key), cost);
  }

  consume(key: string, cost = 1): Decision {
    checkCost(cost);
    const s = this.#current(key);
    const d = this.#decide(s, cost);
    if (d.allowed) s.curr += cost;
    this.#state.put(key, s);
    return d;
  }

  reset(key: string): void {
    this.#state.delete(key);
  }

  sweep(): number {
    const w = Math.floor(this.#now() / this.#windowMs);
    const idle: string[] = [];
    for (const [k, s] of this.#state.entries()) if (w >= s.window + 2 || (s.curr === 0 && (s.prev === 0 || w > s.window))) idle.push(k);
    for (const k of idle) this.#state.delete(k);
    return idle.length;
  }

  /** State rolled forward to the current window (a copy — callers decide whether to persist). */
  #current(key: string): WindowState {
    const w = Math.floor(this.#now() / this.#windowMs);
    const s = this.#state.peek(key);
    if (!s || w >= s.window + 2) return { window: w, curr: 0, prev: 0 };
    if (w === s.window + 1) return { window: w, curr: 0, prev: s.curr };
    return { ...s };
  }

  #decide(s: WindowState, cost: number): Decision {
    const W = this.#windowMs;
    const elapsed = this.#now() - s.window * W;
    const estimate = s.prev * (1 - elapsed / W) + s.curr;
    if (estimate + cost <= this.#limit + EPS) {
      return { allowed: true, remaining: Math.max(0, Math.floor(this.#limit - estimate - cost + EPS)), retryAfterMs: 0 };
    }
    if (cost > this.#limit) return { allowed: false, remaining: 0, retryAfterMs: Infinity };
    let retryAfterMs: number;
    if (s.curr + cost <= this.#limit) {
      // wait for the previous window's weight to decay enough inside this window
      retryAfterMs = ceilMs(W * (1 - (this.#limit - cost - s.curr) / s.prev) - elapsed);
    } else {
      // must wait for the next window, where today's `curr` becomes `prev` and decays
      const offset = W * (1 - (this.#limit - cost) / s.curr);
      retryAfterMs = ceilMs(W - elapsed + offset);
    }
    return { allowed: false, remaining: 0, retryAfterMs };
  }
}

export interface LimiterDecision extends Decision {
  /** names of the rules that denied the request (empty when allowed) */
  deniedBy: string[];
}

/**
 * Combines several rules (e.g. 10/s burst AND 1000/hour). A request is charged against
 * ALL rules or NONE — never a partial charge.
 */
export class RateLimiter {
  #rules: RateLimitStrategy[];

  constructor(rules: RateLimitStrategy[]) {
    if (rules.length === 0) throw new RangeError('at least one rule is required');
    this.#rules = rules;
  }

  /** Evaluate without charging. */
  check(key: string, cost = 1): LimiterDecision {
    return this.#combine(this.#rules.map((r) => r.check(key, cost)));
  }

  /** Charge every rule if all allow; otherwise charge nothing. */
  consume(key: string, cost = 1): LimiterDecision {
    const pre = this.#combine(this.#rules.map((r) => r.check(key, cost)));
    if (!pre.allowed) return pre;
    return this.#combine(this.#rules.map((r) => r.consume(key, cost)));
  }

  reset(key: string): void {
    for (const r of this.#rules) r.reset(key);
  }

  sweep(): number {
    return this.#rules.reduce((n, r) => n + r.sweep(), 0);
  }

  #combine(ds: Decision[]): LimiterDecision {
    const deniedBy = this.#rules.filter((_, i) => !ds[i].allowed).map((r) => r.name);
    const allowed = deniedBy.length === 0;
    return {
      allowed,
      deniedBy,
      remaining: allowed ? Math.min(...ds.map((d) => d.remaining)) : 0,
      retryAfterMs: allowed ? 0 : Math.max(...ds.map((d) => d.retryAfterMs)),
    };
  }
}

/** HTTP `Retry-After` value in whole seconds (rounded up). Returns null when retrying can never succeed. */
export function retryAfterHeader(retryAfterMs: number): string | null {
  if (!Number.isFinite(retryAfterMs)) return null;
  return String(Math.ceil(Math.max(0, retryAfterMs) / 1000));
}
