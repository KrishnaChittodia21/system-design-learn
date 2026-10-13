// STARTER — implement every function/method. Run: npm run project -- resilient-client
// Erasable TypeScript only (no enums / parameter properties / namespaces).
// Never read Date.now / Math.random / setTimeout directly in your logic — use the injected options,
// falling back to the real ones only as defaults.

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Minimal timer API so tests can drive deadlines with fake timers. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Real sleep: resolves after `ms`; rejects with `signal.reason` if the signal is (or becomes) aborted. */
export const realSleep: Sleep = (ms, signal) => {
  throw new Error('Not implemented: realSleep');
};

// ---- Error types (provided — they are part of the contract the tests check with instanceof) ----

export class DeadlineExceededError extends Error {
  constructor(message = 'deadline exceeded', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DeadlineExceededError';
  }
}

export class CircuitOpenError extends Error {
  /** ms until the breaker will allow a probe */
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super('circuit open');
    this.name = 'CircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class BulkheadFullError extends Error {
  constructor() {
    super('bulkhead full');
    this.name = 'BulkheadFullError';
  }
}

/**
 * Transient failures only. In order:
 * - non-objects → false; `retryable: false` → false; `retryable: true` → true
 * - numeric `status` → true only for 408, 429, 500, 502, 503, 504 (other 4xx are the caller's fault)
 * - string `code` → true for ECONNRESET, ECONNREFUSED, ETIMEDOUT, EAI_AGAIN, EPIPE
 * - anything else → false
 */
export function defaultIsRetryable(err: unknown): boolean {
  throw new Error('Not implemented: defaultIsRetryable');
}

/**
 * Exponential backoff with FULL jitter (AWS architecture blog):
 *   floor(random() * min(maxMs, baseMs * 2 ** retryIndex))     — retryIndex is 0 for the first retry
 */
export function backoffDelay(retryIndex: number, baseMs: number, maxMs: number, random: () => number = Math.random): number {
  throw new Error('Not implemented: backoffDelay');
}

export interface RetryBudgetOptions {
  /** tokens earned per original request (default 0.2 → retries ≤ ~20% of traffic) */
  ratio?: number;
  /** starting tokens (default 10), capped at max */
  initial?: number;
  /** cap on stored tokens (default 100) */
  max?: number;
}

/** Token bucket for retries: each original request deposits `ratio`, each retry withdraws 1. Stops retry storms. */
export class RetryBudget {
  constructor(options: RetryBudgetOptions = {}) {
    throw new Error('Not implemented: RetryBudget.constructor');
  }
  get tokens(): number {
    throw new Error('Not implemented: RetryBudget.tokens');
  }
  /** Deposit `ratio` tokens (capped at max). */
  recordRequest(): void {
    throw new Error('Not implemented: RetryBudget.recordRequest');
  }
  /** Take one token if available (>= 1) and return true; otherwise false. */
  tryWithdraw(): boolean {
    throw new Error('Not implemented: RetryBudget.tryWithdraw');
  }
}

export interface RetryOptions {
  /** total attempts including the first (default 3) */
  maxAttempts?: number;
  /** default 100 */
  baseDelayMs?: number;
  /** default 10_000 */
  maxDelayMs?: number;
  random?: () => number;
  sleep?: Sleep;
  /** used for the per-attempt deadline timer */
  timers?: Timers;
  now?: () => number;
  /** default defaultIsRetryable */
  isRetryable?: (err: unknown) => boolean;
  /** overall time budget (ms, from the call) for all attempts and sleeps */
  deadlineMs?: number;
  /** caller cancellation */
  signal?: AbortSignal;
  budget?: RetryBudget;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/**
 * Call `fn(attempt, signal)` (attempt is 0-based) and retry transient failures.
 * - budget?.recordRequest() once per retry() call; each retry needs budget.tryWithdraw() — if it fails, throw the last error.
 * - Non-retryable error or last attempt → rethrow the error itself (not wrapped).
 * - Before retry k (0-based) sleep backoffDelay(k, base, max, random) via the injected `sleep(ms, signal)`; call onRetry first.
 * - Deadline: each attempt's signal aborts (and retry() stops waiting, even if fn ignores the signal) when the
 *   remaining deadline elapses, using `timers.setTimeout`; retry() then rejects with DeadlineExceededError.
 *   If the next sleep would end at/after the deadline, don't sleep: reject with DeadlineExceededError (cause = last error).
 *   Clear the timer when an attempt settles.
 * - Caller `signal`: if aborted (before an attempt, during an attempt, or during sleep) reject with signal.reason
 *   and abort the attempt's signal.
 */
export async function retry<T>(fn: (attempt: number, signal: AbortSignal) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  throw new Error('Not implemented: retry');
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** consecutive failures (while closed) that open the circuit (default 5) */
  failureThreshold?: number;
  /** how long to stay open before allowing probes (default 10_000 ms) */
  resetTimeoutMs?: number;
  /** concurrent probe calls allowed while half-open (default 1); extra calls get CircuitOpenError(0) */
  halfOpenMaxProbes?: number;
  /** probe successes needed to close again (default 1) */
  successThreshold?: number;
  now?: () => number;
  /** which errors count as dependency failures (default: all). Others are rethrown but count as a success. */
  isFailure?: (err: unknown) => boolean;
  /** called on every state change, including open → half-open (observed lazily via `state` / execute) */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

/**
 * closed ──(failureThreshold consecutive failures)──► open ──(resetTimeoutMs elapsed)──► half-open
 * half-open ──(successThreshold probe successes)──► closed;   half-open ──(any probe failure)──► open (timer restarts)
 * A success while closed resets the consecutive-failure count.
 */
export class CircuitBreaker {
  constructor(options: CircuitBreakerOptions = {}) {
    throw new Error('Not implemented: CircuitBreaker.constructor');
  }
  /** Current state; an open circuit whose timeout has elapsed reports (and becomes) 'half-open'. */
  get state(): CircuitState {
    throw new Error('Not implemented: CircuitBreaker.state');
  }
  /** Open → reject with CircuitOpenError(ms until half-open) WITHOUT calling fn. */
  execute<T>(fn: () => Promise<T>): Promise<T> {
    throw new Error('Not implemented: CircuitBreaker.execute');
  }
}

export interface BulkheadOptions {
  /** >= 1, else RangeError */
  maxConcurrent: number;
  /** callers allowed to wait (FIFO) for a slot (default 0 = reject immediately when full) */
  maxQueue?: number;
}

/** Caps concurrent calls to one dependency. Full (and queue full) → reject with BulkheadFullError without calling fn. */
export class Bulkhead {
  constructor(options: BulkheadOptions) {
    throw new Error('Not implemented: Bulkhead.constructor');
  }
  get active(): number {
    throw new Error('Not implemented: Bulkhead.active');
  }
  get queued(): number {
    throw new Error('Not implemented: Bulkhead.queued');
  }
  execute<T>(fn: () => Promise<T>): Promise<T> {
    throw new Error('Not implemented: Bulkhead.execute');
  }
}

export interface ResilienceOptions {
  retry?: RetryOptions;
  breaker?: CircuitBreaker;
  bulkhead?: Bulkhead;
}

/**
 * Compose: bulkhead( retry( breaker( fn ) ) ). The bulkhead holds one slot for the whole call,
 * every attempt goes through the breaker, and CircuitOpenError / BulkheadFullError are never retried
 * (on top of the caller's isRetryable).
 */
export function callResilient<T>(fn: (attempt: number, signal: AbortSignal) => Promise<T>, options: ResilienceOptions = {}): Promise<T> {
  throw new Error('Not implemented: callResilient');
}
