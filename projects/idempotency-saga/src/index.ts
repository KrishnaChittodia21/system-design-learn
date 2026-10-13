// STARTER — Idempotency keys + an orchestrated saga.
// Implement every function/method below. Run the judge with:  npm run project -- idempotency-saga
// Keep the exported names and signatures: the tests import them.

// ---------------------------------------------------------------------------
// Part 1: idempotency keys
// ---------------------------------------------------------------------------

/** What the HTTP layer would send back. Stored verbatim so duplicates can be replayed. */
export interface StoredResponse {
  status: number;
  body: unknown;
}

export interface IdempotencyRecord {
  key: string;
  /** hash of the request payload that first used this key */
  fingerprint: string;
  status: 'in_progress' | 'completed';
  response?: StoredResponse;
  createdAt: number;
  /** absolute time (ms) after which the record is ignored and may be purged */
  expiresAt: number;
}

export interface IdempotencyStoreOptions {
  /** how long a COMPLETED record is kept for replay (ms) */
  ttlMs: number;
  /**
   * how long an IN-PROGRESS lock is honoured (ms). If the worker that took the lock
   * crashed, a retry after this lease is allowed to start over. Defaults to ttlMs.
   */
  lockTtlMs?: number;
  /** injected clock; defaults to Date.now */
  now?: () => number;
}

export type BeginResult =
  | { kind: 'started' }
  | { kind: 'in_progress' }
  | { kind: 'mismatch' }
  | { kind: 'replay'; response: StoredResponse };

/**
 * Canonical fingerprint of a JSON-like payload, e.g. SHA-256 (node:crypto) of a JSON
 * encoding with object keys sorted recursively, so `{a:1,b:2}` and `{b:2,a:1}` match.
 * Array order DOES matter.
 */
export function fingerprint(payload: unknown): string {
  throw new Error('Not implemented: fingerprint');
}

/**
 * In-memory idempotency store. In production this is a table with a unique index on
 * `key`; `begin` is the atomic "INSERT ... ON CONFLICT DO NOTHING". Keep `begin`
 * synchronous so it is atomic with respect to concurrent async callers.
 */
export class IdempotencyStore {
  constructor(opts: IdempotencyStoreOptions) {
    throw new Error('Not implemented: IdempotencyStore.constructor');
  }

  /**
   * Atomically claim `key` for a request whose payload has fingerprint `fp`.
   * - no live record → create an in_progress record (expires after lockTtlMs) → `started`
   * - live record with a different fingerprint → `mismatch`
   * - live completed record → `replay` with a COPY of the stored response
   * - live in_progress record → `in_progress`
   */
  begin(key: string, fp: string): BeginResult {
    throw new Error('Not implemented: IdempotencyStore.begin');
  }

  /** Store the final response (a copy) for an in-progress key; it now expires ttlMs from now. Throws if the key is not in progress. */
  complete(key: string, response: StoredResponse): void {
    throw new Error('Not implemented: IdempotencyStore.complete');
  }

  /** Release an in-progress lock (the handler failed in a retryable way). No-op otherwise. */
  abandon(key: string): void {
    throw new Error('Not implemented: IdempotencyStore.abandon');
  }

  /** The live (non-expired: now < expiresAt) record for `key`, if any. Purge expired ones lazily. */
  get(key: string): IdempotencyRecord | undefined {
    throw new Error('Not implemented: IdempotencyStore.get');
  }
}

export interface IdempotentResponse extends StoredResponse {
  /** true when this response was replayed from the store instead of running the handler */
  replayed: boolean;
}

/**
 * Run `handler` at most once per idempotency key.
 * - missing/empty key → 400 (handler not run)
 * - first request → run handler, store and return its response (any status, including 4xx, is stored)
 * - duplicate while the first is still running → 409
 * - duplicate after completion → stored response with `replayed: true`
 * - same key, different payload → 422
 * - handler throws → release the lock (so the client can retry) and rethrow
 */
export async function handleIdempotent(
  store: IdempotencyStore,
  key: string | undefined,
  payload: unknown,
  handler: () => Promise<StoredResponse>,
): Promise<IdempotentResponse> {
  throw new Error('Not implemented: handleIdempotent');
}

// ---------------------------------------------------------------------------
// Part 2: orchestrated saga
// ---------------------------------------------------------------------------

export type SagaStatus = 'running' | 'compensating' | 'completed' | 'compensated' | 'failed';

/** Everything needed to resume a saga after a crash. Must be structured-clone safe. */
export interface SagaState<C> {
  id: string;
  status: SagaStatus;
  ctx: C;
  /** names of steps whose action completed, in execution order */
  completedSteps: string[];
  /** names of steps whose compensation completed (steps with no compensate may be listed too) */
  compensatedSteps: string[];
  /** true once the pivot step's action has completed — no going back after this */
  pivotPassed: boolean;
  /** message of the error that triggered compensation / failure */
  error?: string;
  /** audit trail, e.g. "action:reserve", "action-failed:charge", "compensate:reserve" */
  history: string[];
}

/** Durable storage for saga state. Implementations MUST copy on save and on load. */
export interface SagaStore<C> {
  load(id: string): Promise<SagaState<C> | undefined>;
  save(state: SagaState<C>): Promise<void>;
}

/** Map-backed SagaStore that deep-copies (structuredClone) on save and load. */
export class InMemorySagaStore<C> implements SagaStore<C> {
  async load(id: string): Promise<SagaState<C> | undefined> {
    throw new Error('Not implemented: InMemorySagaStore.load');
  }
  async save(state: SagaState<C>): Promise<void> {
    throw new Error('Not implemented: InMemorySagaStore.save');
  }
}

/** Passed to every action and compensation. */
export interface StepMeta {
  sagaId: string;
  step: string;
  /** stable across retries AND crash-resumes: `${sagaId}:${step}` (compensations: `${sagaId}:${step}:compensate`) */
  idempotencyKey: string;
  /** 1-based attempt number within this run */
  attempt: number;
}

export interface SagaStep<C> {
  name: string;
  /** Forward action. May return a partial context that is merged into ctx and persisted. */
  action: (ctx: C, meta: StepMeta) => Promise<Partial<C> | void>;
  /** Semantic undo. Omit for steps that need no undo (reads, validations). */
  compensate?: (ctx: C, meta: StepMeta) => Promise<void>;
  /** extra attempts for the action before it counts as failed (default 0) */
  retries?: number;
  /**
   * The point of no return. Once the pivot's action succeeds the saga can only move
   * forward: later steps are retried (up to forwardRetries) and are never compensated.
   */
  pivot?: boolean;
}

export interface SagaOrchestratorOptions<C> {
  steps: SagaStep<C>[];
  store: SagaStore<C>;
  /** attempts per compensation before the saga is marked failed (default 3) */
  compensationRetries?: number;
  /** attempts for each post-pivot step before the saga is marked failed (default 5) */
  forwardRetries?: number;
}

/**
 * Orchestrator rules (the tests check each one):
 * - Persist state with `store.save` after creating it and after EVERY transition
 *   (step done, status change, compensation done). Errors thrown by the store are a
 *   "crash": let them propagate; never catch them.
 * - Forward: run steps in order, skipping ones already in completedSteps. A step gets
 *   `(retries ?? 0) + 1` attempts. Merge a returned patch into ctx.
 * - A step that fails before the pivot passed → status 'compensating' (error recorded),
 *   then compensate the COMPLETED steps in reverse completion order; the failed step itself
 *   is not compensated. Each compensation gets compensationRetries attempts; if one is
 *   exhausted → status 'failed'. All done → 'compensated'.
 * - After the pivot passed, each remaining step gets max(forwardRetries, retries + 1)
 *   attempts; if exhausted → 'failed' with no compensation.
 * - All steps done → 'completed'.
 * - Constructor throws on duplicate step names or more than one pivot.
 */
export class SagaOrchestrator<C extends object> {
  constructor(opts: SagaOrchestratorOptions<C>) {
    throw new Error('Not implemented: SagaOrchestrator.constructor');
  }

  /** Start saga `id` with the initial context. If it already exists in the store, resume it instead (idempotent start). Returns a copy of the final state. */
  async start(id: string, ctx: C): Promise<SagaState<C>> {
    throw new Error('Not implemented: SagaOrchestrator.start');
  }

  /** Continue a saga from its persisted state (after a crash). Terminal sagas are returned as-is. Throws `unknown saga: <id>` if missing. */
  async resume(id: string): Promise<SagaState<C>> {
    throw new Error('Not implemented: SagaOrchestrator.resume');
  }
}
