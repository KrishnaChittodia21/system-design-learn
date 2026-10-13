// STARTER — implement every method. Run: npm run project -- rate-limiter
// Erasable TypeScript only (no enums / parameter properties / namespaces). Never call Date.now()
// directly in your logic — use the injected `now` so tests are deterministic.

/** Result of checking / consuming against one rule (or the combined limiter). */
export interface Decision {
  allowed: boolean;
  /** whole units still available after this request (0 when denied) */
  remaining: number;
  /** ms until a request of the same cost could succeed; 0 when allowed; Infinity when it never can */
  retryAfterMs: number;
}

/** Every algorithm implements this (Strategy pattern), so the limiter doesn't care which it is. */
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
  /** defaults to 'token-bucket' */
  name?: string;
  /** maximum tokens (burst size), > 0 — a new key starts full */
  capacity: number;
  /** tokens added per second (continuously, fractional tokens allowed), > 0 */
  refillPerSecond: number;
  now?: () => number;
  /** memory bound: when a NEW key would exceed this, evict the least-recently-used key */
  maxKeys?: number;
}

/**
 * Token bucket. Lazily refill on access: tokens = min(capacity, tokens + elapsed * rate).
 * Denied → retryAfterMs = time until `cost` tokens exist (Infinity if cost > capacity).
 * Costs must be positive finite numbers (else RangeError).
 */
export class TokenBucket implements RateLimitStrategy {
  readonly name: string;
  /** @throws RangeError for non-positive capacity / refillPerSecond */
  constructor(options: TokenBucketOptions) {
    throw new Error('Not implemented: TokenBucket.constructor');
  }
  get size(): number {
    throw new Error('Not implemented: TokenBucket.size');
  }
  check(key: string, cost = 1): Decision {
    throw new Error('Not implemented: TokenBucket.check');
  }
  consume(key: string, cost = 1): Decision {
    throw new Error('Not implemented: TokenBucket.consume');
  }
  reset(key: string): void {
    throw new Error('Not implemented: TokenBucket.reset');
  }
  /** A bucket that has refilled to capacity is idle. */
  sweep(): number {
    throw new Error('Not implemented: TokenBucket.sweep');
  }
}

export interface SlidingWindowOptions {
  /** defaults to 'sliding-window' */
  name?: string;
  /** max units per window, > 0 */
  limit: number;
  /** window length in ms, > 0. Fixed windows are aligned to multiples of windowMs (floor(now / windowMs)). */
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}

/**
 * Sliding-window counter (the Cloudflare approximation): keep counts for the current and
 * previous fixed windows and weight the previous one by how much of it still overlaps:
 *   estimate = prev * (1 - elapsedInCurrentWindow / windowMs) + curr
 * Allowed when estimate + cost <= limit. Denied → retryAfterMs is the exact earliest time
 * (rounded up to a whole ms) the same request would be allowed; Infinity if cost > limit.
 */
export class SlidingWindowCounter implements RateLimitStrategy {
  readonly name: string;
  constructor(options: SlidingWindowOptions) {
    throw new Error('Not implemented: SlidingWindowCounter.constructor');
  }
  get size(): number {
    throw new Error('Not implemented: SlidingWindowCounter.size');
  }
  check(key: string, cost = 1): Decision {
    throw new Error('Not implemented: SlidingWindowCounter.check');
  }
  consume(key: string, cost = 1): Decision {
    throw new Error('Not implemented: SlidingWindowCounter.consume');
  }
  reset(key: string): void {
    throw new Error('Not implemented: SlidingWindowCounter.reset');
  }
  /** A key whose current and previous counts are both effectively zero is idle. */
  sweep(): number {
    throw new Error('Not implemented: SlidingWindowCounter.sweep');
  }
}

export interface LimiterDecision extends Decision {
  /** names of the rules that denied the request (empty when allowed) */
  deniedBy: string[];
}

/**
 * Combines several rules (e.g. 10/s burst AND 1000/hour). A request is charged against
 * ALL rules or NONE — never a partial charge. Allowed → remaining = min over rules.
 * Denied → retryAfterMs = max over the denying rules.
 */
export class RateLimiter {
  /** @throws RangeError when `rules` is empty */
  constructor(rules: RateLimitStrategy[]) {
    throw new Error('Not implemented: RateLimiter.constructor');
  }
  /** Evaluate without charging. */
  check(key: string, cost = 1): LimiterDecision {
    throw new Error('Not implemented: RateLimiter.check');
  }
  /** Charge every rule if all allow; otherwise charge nothing. */
  consume(key: string, cost = 1): LimiterDecision {
    throw new Error('Not implemented: RateLimiter.consume');
  }
  reset(key: string): void {
    throw new Error('Not implemented: RateLimiter.reset');
  }
  /** Sweep every rule; returns the total number of keys dropped. */
  sweep(): number {
    throw new Error('Not implemented: RateLimiter.sweep');
  }
}

/** HTTP `Retry-After` value in whole seconds (rounded up, e.g. 1 ms → "1", 0 → "0"). null when retrying can never succeed. */
export function retryAfterHeader(retryAfterMs: number): string | null {
  throw new Error('Not implemented: retryAfterHeader');
}
