// Reference solution: retries with exponential backoff + full jitter, deadlines and cancellation,
// a retry budget, a circuit breaker and a bulkhead — every source of time/randomness injected.

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Minimal timer API so tests can drive deadlines with fake timers. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Real sleep that rejects with signal.reason when aborted. */
export const realSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

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

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE']);

/** Transient failures only: explicit `retryable: true`, 408/429/5xx-gateway statuses, or network error codes. */
export function defaultIsRetryable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { retryable?: unknown; status?: unknown; code?: unknown };
  if (e.retryable === false) return false;
  if (e.retryable === true) return true;
  if (typeof e.status === 'number') return RETRYABLE_STATUS.has(e.status);
  return typeof e.code === 'string' && RETRYABLE_CODES.has(e.code);
}

/** Full jitter: uniform in [0, min(maxMs, baseMs * 2^retryIndex)), floored to whole ms. */
export function backoffDelay(retryIndex: number, baseMs: number, maxMs: number, random: () => number = Math.random): number {
  const cap = Math.min(maxMs, baseMs * 2 ** retryIndex);
  return Math.floor(random() * cap);
}

export interface RetryBudgetOptions {
  /** tokens earned per original request (default 0.2 → retries ≤ ~20% of traffic) */
  ratio?: number;
  /** starting tokens (default 10) — lets a quiet service retry a little */
  initial?: number;
  /** cap on stored tokens (default 100) */
  max?: number;
}

/** Token bucket for retries: requests deposit `ratio`, each retry withdraws 1. Stops retry storms. */
export class RetryBudget {
  #tokens: number;
  #ratio: number;
  #max: number;
  constructor(options: RetryBudgetOptions = {}) {
    this.#ratio = options.ratio ?? 0.2;
    this.#max = options.max ?? 100;
    this.#tokens = Math.min(this.#max, options.initial ?? 10);
  }
  get tokens(): number {
    return this.#tokens;
  }
  recordRequest(): void {
    this.#tokens = Math.min(this.#max, this.#tokens + this.#ratio);
  }
  tryWithdraw(): boolean {
    if (this.#tokens < 1 - 1e-9) return false;
    this.#tokens -= 1;
    return true;
  }
}

export interface RetryOptions {
  /** total attempts including the first (default 3) */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  sleep?: Sleep;
  timers?: Timers;
  now?: () => number;
  isRetryable?: (err: unknown) => boolean;
  /** overall time budget for all attempts and sleeps, from the call */
  deadlineMs?: number;
  /** caller cancellation */
  signal?: AbortSignal;
  budget?: RetryBudget;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/** Call `fn` with retries. `fn` receives the 0-based attempt number and a per-attempt AbortSignal. */
export async function retry<T>(fn: (attempt: number, signal: AbortSignal) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const base = options.baseDelayMs ?? 100;
  const maxDelay = options.maxDelayMs ?? 10_000;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? realSleep;
  const timers = options.timers ?? realTimers;
  const now = options.now ?? Date.now;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const { signal, budget } = options;
  const deadlineAt = options.deadlineMs === undefined ? undefined : now() + options.deadlineMs;

  budget?.recordRequest();
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) throw signal.reason;
    if (deadlineAt !== undefined && now() >= deadlineAt) throw new DeadlineExceededError('deadline exceeded', { cause: lastError });
    try {
      return await runAttempt(fn, attempt, signal, deadlineAt === undefined ? undefined : deadlineAt - now(), timers);
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      if (err instanceof DeadlineExceededError) throw err;
      lastError = err;
      if (attempt === maxAttempts - 1 || !isRetryable(err)) throw err;
      if (budget && !budget.tryWithdraw()) throw err;
      const delayMs = backoffDelay(attempt, base, maxDelay, random);
      // don't start a sleep we know will blow the deadline
      if (deadlineAt !== undefined && now() + delayMs >= deadlineAt) throw new DeadlineExceededError('deadline exceeded', { cause: err });
      options.onRetry?.({ attempt, delayMs, error: err });
      await sleep(delayMs, signal);
    }
  }
  throw lastError; // unreachable unless maxAttempts <= 0
}

/** One attempt, aborted (and abandoned) when the caller aborts or the remaining deadline elapses. */
function runAttempt<T>(
  fn: (attempt: number, signal: AbortSignal) => Promise<T>,
  attempt: number,
  parent: AbortSignal | undefined,
  remainingMs: number | undefined,
  timers: Timers,
): Promise<T> {
  const ac = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const onParentAbort = () => ac.abort(parent!.reason);
    parent?.addEventListener('abort', onParentAbort, { once: true });
    const timer = remainingMs === undefined ? undefined : timers.setTimeout(() => ac.abort(new DeadlineExceededError()), remainingMs);
    const cleanup = () => {
      parent?.removeEventListener('abort', onParentAbort);
      if (timer !== undefined) timers.clearTimeout(timer);
    };
    // stop waiting even if fn ignores its signal
    ac.signal.addEventListener('abort', () => {
      cleanup();
      reject(ac.signal.reason);
    }, { once: true });
    Promise.resolve()
      .then(() => fn(attempt, ac.signal))
      .then(
        (v) => {
          cleanup();
          resolve(v);
        },
        (e) => {
          cleanup();
          reject(e);
        },
      );
  });
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** consecutive failures that open the circuit (default 5) */
  failureThreshold?: number;
  /** how long to stay open before allowing probes (default 10s) */
  resetTimeoutMs?: number;
  /** concurrent probe calls allowed while half-open (default 1) */
  halfOpenMaxProbes?: number;
  /** probe successes needed to close again (default 1) */
  successThreshold?: number;
  now?: () => number;
  /** which errors count as dependency failures (default: all). Others are rethrown but count as success. */
  isFailure?: (err: unknown) => boolean;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export class CircuitBreaker {
  #failureThreshold: number;
  #resetMs: number;
  #maxProbes: number;
  #successThreshold: number;
  #now: () => number;
  #isFailure: (err: unknown) => boolean;
  #onChange: (from: CircuitState, to: CircuitState) => void;
  #state: CircuitState = 'closed';
  #failures = 0;
  #openedAt = 0;
  #probes = 0;
  #probeSuccesses = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    this.#failureThreshold = options.failureThreshold ?? 5;
    this.#resetMs = options.resetTimeoutMs ?? 10_000;
    this.#maxProbes = options.halfOpenMaxProbes ?? 1;
    this.#successThreshold = options.successThreshold ?? 1;
    this.#now = options.now ?? Date.now;
    this.#isFailure = options.isFailure ?? (() => true);
    this.#onChange = options.onStateChange ?? (() => {});
  }

  /** Current state; an open circuit whose timeout elapsed reports 'half-open'. */
  get state(): CircuitState {
    if (this.#state === 'open' && this.#now() - this.#openedAt >= this.#resetMs) this.#transition('half-open');
    return this.#state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === 'open') throw new CircuitOpenError(this.#openedAt + this.#resetMs - this.#now());
    const probe = state === 'half-open';
    if (probe) {
      if (this.#probes >= this.#maxProbes) throw new CircuitOpenError(0);
      this.#probes++;
    }
    try {
      const v = await fn();
      this.#onSuccess(probe);
      return v;
    } catch (err) {
      if (this.#isFailure(err)) this.#onFailure(probe);
      else this.#onSuccess(probe);
      throw err;
    } finally {
      if (probe) this.#probes--;
    }
  }

  #onSuccess(probe: boolean): void {
    if (probe && this.#state === 'half-open') {
      if (++this.#probeSuccesses >= this.#successThreshold) this.#transition('closed');
    } else if (this.#state === 'closed') {
      this.#failures = 0;
    }
  }

  #onFailure(probe: boolean): void {
    if (probe && this.#state === 'half-open') {
      this.#transition('open');
    } else if (this.#state === 'closed' && ++this.#failures >= this.#failureThreshold) {
      this.#transition('open');
    }
  }

  #transition(to: CircuitState): void {
    const from = this.#state;
    if (from === to) return;
    this.#state = to;
    if (to === 'open') this.#openedAt = this.#now();
    this.#failures = 0;
    this.#probeSuccesses = 0;
    this.#onChange(from, to);
  }
}

export interface BulkheadOptions {
  maxConcurrent: number;
  /** callers allowed to wait for a slot (default 0 = reject immediately when full) */
  maxQueue?: number;
}

/** Caps concurrent calls to one dependency so it can't exhaust the whole process. */
export class Bulkhead {
  #max: number;
  #maxQueue: number;
  #active = 0;
  #queue: Array<() => void> = [];

  constructor(options: BulkheadOptions) {
    if (!(options.maxConcurrent >= 1)) throw new RangeError('maxConcurrent must be >= 1');
    this.#max = options.maxConcurrent;
    this.#maxQueue = options.maxQueue ?? 0;
  }
  get active(): number {
    return this.#active;
  }
  get queued(): number {
    return this.#queue.length;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#max) {
      if (this.#queue.length >= this.#maxQueue) throw new BulkheadFullError();
      await new Promise<void>((resolve) => this.#queue.push(resolve));
    } else {
      this.#active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.#queue.shift();
      if (next) next();
      else this.#active--;
    }
  }
}

export interface ResilienceOptions {
  retry?: RetryOptions;
  breaker?: CircuitBreaker;
  bulkhead?: Bulkhead;
}

/**
 * bulkhead( retry( breaker( fn ) ) ): the bulkhead bounds the whole call, each attempt goes
 * through the breaker, and an open circuit is never retried.
 */
export function callResilient<T>(fn: (attempt: number, signal: AbortSignal) => Promise<T>, options: ResilienceOptions = {}): Promise<T> {
  const { breaker, bulkhead } = options;
  const userRetryable = options.retry?.isRetryable ?? defaultIsRetryable;
  const run = () =>
    retry((attempt, signal) => (breaker ? breaker.execute(() => fn(attempt, signal)) : fn(attempt, signal)), {
      ...options.retry,
      isRetryable: (e) => !(e instanceof CircuitOpenError) && !(e instanceof BulkheadFullError) && userRetryable(e),
    });
  return bulkhead ? bulkhead.execute(run) : run();
}
