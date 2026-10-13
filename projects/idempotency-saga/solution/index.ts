// Reference solution: idempotency keys + an orchestrated saga.
//
// Part 1 — IdempotencyStore / handleIdempotent: the Stripe-style "Idempotency-Key" header.
// Part 2 — SagaOrchestrator: a persisted, resumable, compensating workflow engine.
import { createHash } from 'node:crypto';

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
 * Canonical fingerprint of a JSON-like payload: SHA-256 of a JSON encoding with
 * object keys sorted recursively, so `{a:1,b:2}` and `{b:2,a:1}` match.
 */
export function fingerprint(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

/**
 * In-memory idempotency store. In production this is a table with a unique index on
 * `key` (INSERT ... ON CONFLICT DO NOTHING is the atomic "begin"). Here `begin` is
 * synchronous, which makes it atomic with respect to other async callers.
 */
export class IdempotencyStore {
  #records = new Map<string, IdempotencyRecord>();
  #ttlMs: number;
  #lockTtlMs: number;
  #now: () => number;

  constructor(opts: IdempotencyStoreOptions) {
    this.#ttlMs = opts.ttlMs;
    this.#lockTtlMs = opts.lockTtlMs ?? opts.ttlMs;
    this.#now = opts.now ?? Date.now;
  }

  /** Atomically claim `key` for a request with the given payload fingerprint. */
  begin(key: string, fp: string): BeginResult {
    const now = this.#now();
    const existing = this.get(key);
    if (existing) {
      // Same key reused for a different request body is a client bug → 422.
      if (existing.fingerprint !== fp) return { kind: 'mismatch' };
      if (existing.status === 'completed') return { kind: 'replay', response: structuredClone(existing.response!) };
      return { kind: 'in_progress' };
    }
    this.#records.set(key, { key, fingerprint: fp, status: 'in_progress', createdAt: now, expiresAt: now + this.#lockTtlMs });
    return { kind: 'started' };
  }

  /** Store the final response for a key we own and start its replay TTL. */
  complete(key: string, response: StoredResponse): void {
    const rec = this.#records.get(key);
    if (!rec || rec.status !== 'in_progress') throw new Error(`complete: key ${key} is not in progress`);
    rec.status = 'completed';
    rec.response = structuredClone(response);
    rec.expiresAt = this.#now() + this.#ttlMs;
  }

  /** Release an in-progress lock (the handler failed in a retryable way). */
  abandon(key: string): void {
    const rec = this.#records.get(key);
    if (rec && rec.status === 'in_progress') this.#records.delete(key);
  }

  /** The live (non-expired) record for `key`, if any. Expired records are purged lazily. */
  get(key: string): IdempotencyRecord | undefined {
    const rec = this.#records.get(key);
    if (!rec) return undefined;
    if (this.#now() >= rec.expiresAt) {
      this.#records.delete(key);
      return undefined;
    }
    return rec;
  }
}

export interface IdempotentResponse extends StoredResponse {
  /** true when this response was replayed from the store instead of running the handler */
  replayed: boolean;
}

/**
 * Run `handler` at most once per idempotency key.
 * - missing/empty key → 400
 * - first request → runs handler, stores and returns its response (any status, including 4xx, is stored)
 * - duplicate while the first is still running → 409
 * - duplicate after completion → stored response, `replayed: true`
 * - same key, different payload → 422
 * - handler throws → lock released (so the client can retry) and the error is rethrown
 */
export async function handleIdempotent(
  store: IdempotencyStore,
  key: string | undefined,
  payload: unknown,
  handler: () => Promise<StoredResponse>,
): Promise<IdempotentResponse> {
  if (!key) return { status: 400, body: { error: 'Idempotency-Key header is required' }, replayed: false };
  const begun = store.begin(key, fingerprint(payload));
  switch (begun.kind) {
    case 'mismatch':
      return { status: 422, body: { error: 'Idempotency-Key reused with a different payload' }, replayed: false };
    case 'in_progress':
      return { status: 409, body: { error: 'A request with this Idempotency-Key is in progress' }, replayed: false };
    case 'replay':
      return { ...begun.response, replayed: true };
    case 'started':
      break;
  }
  let response: StoredResponse;
  try {
    response = await handler();
  } catch (err) {
    store.abandon(key);
    throw err;
  }
  store.complete(key, response);
  return { ...structuredClone(response), replayed: false };
}

// ---------------------------------------------------------------------------
// Part 2: orchestrated saga
// ---------------------------------------------------------------------------

export type SagaStatus = 'running' | 'compensating' | 'completed' | 'compensated' | 'failed';

/** Everything needed to resume a saga after a crash. Must be JSON/structured-clone safe. */
export interface SagaState<C> {
  id: string;
  status: SagaStatus;
  ctx: C;
  /** names of steps whose action completed, in execution order */
  completedSteps: string[];
  /** names of steps whose compensation completed */
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

export class InMemorySagaStore<C> implements SagaStore<C> {
  #data = new Map<string, SagaState<C>>();
  async load(id: string): Promise<SagaState<C> | undefined> {
    const s = this.#data.get(id);
    return s ? structuredClone(s) : undefined;
  }
  async save(state: SagaState<C>): Promise<void> {
    this.#data.set(state.id, structuredClone(state));
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

export class SagaOrchestrator<C extends object> {
  #steps: SagaStep<C>[];
  #store: SagaStore<C>;
  #compRetries: number;
  #fwdRetries: number;

  constructor(opts: SagaOrchestratorOptions<C>) {
    const names = new Set<string>();
    for (const s of opts.steps) {
      if (names.has(s.name)) throw new Error(`duplicate step name: ${s.name}`);
      names.add(s.name);
    }
    if (opts.steps.filter((s) => s.pivot).length > 1) throw new Error('at most one pivot step');
    this.#steps = opts.steps;
    this.#store = opts.store;
    this.#compRetries = opts.compensationRetries ?? 3;
    this.#fwdRetries = opts.forwardRetries ?? 5;
  }

  /** Start saga `id` with the initial context. If it already exists, resume it instead (idempotent start). */
  async start(id: string, ctx: C): Promise<SagaState<C>> {
    const existing = await this.#store.load(id);
    if (existing) return this.#drive(existing);
    const state: SagaState<C> = {
      id,
      status: 'running',
      ctx: structuredClone(ctx),
      completedSteps: [],
      compensatedSteps: [],
      pivotPassed: false,
      history: [],
    };
    await this.#store.save(state);
    return this.#drive(state);
  }

  /** Continue a saga from its persisted state (after a crash). Terminal sagas are returned as-is. */
  async resume(id: string): Promise<SagaState<C>> {
    const state = await this.#store.load(id);
    if (!state) throw new Error(`unknown saga: ${id}`);
    return this.#drive(state);
  }

  async #drive(state: SagaState<C>): Promise<SagaState<C>> {
    if (state.status === 'running') await this.#forward(state);
    if (state.status === 'compensating') await this.#backward(state);
    return structuredClone(state);
  }

  async #forward(state: SagaState<C>): Promise<void> {
    for (const step of this.#steps) {
      if (state.completedSteps.includes(step.name)) continue;
      // After the pivot we must go forward, so retry harder and never compensate.
      const attempts = state.pivotPassed ? Math.max(this.#fwdRetries, (step.retries ?? 0) + 1) : (step.retries ?? 0) + 1;
      let lastErr: unknown;
      let ok = false;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const meta: StepMeta = { sagaId: state.id, step: step.name, idempotencyKey: `${state.id}:${step.name}`, attempt };
        let patch: Partial<C> | void;
        try {
          // Only the user's code is inside try: store errors (a crash) must propagate.
          patch = await step.action(structuredClone(state.ctx), meta);
        } catch (err) {
          lastErr = err;
          state.history.push(`action-failed:${step.name}`);
          continue;
        }
        if (patch) state.ctx = { ...state.ctx, ...patch };
        state.completedSteps.push(step.name);
        state.history.push(`action:${step.name}`);
        if (step.pivot) state.pivotPassed = true;
        await this.#store.save(state);
        ok = true;
        break;
      }
      if (!ok) {
        state.error = errorMessage(lastErr);
        state.status = state.pivotPassed ? 'failed' : 'compensating';
        await this.#store.save(state);
        return;
      }
    }
    state.status = 'completed';
    await this.#store.save(state);
  }

  async #backward(state: SagaState<C>): Promise<void> {
    // Reverse order of what actually completed (not of the declared list).
    const toUndo = [...state.completedSteps].reverse();
    for (const name of toUndo) {
      if (state.compensatedSteps.includes(name)) continue;
      const step = this.#steps.find((s) => s.name === name)!;
      if (!step.compensate) {
        state.compensatedSteps.push(name);
        await this.#store.save(state);
        continue;
      }
      let ok = false;
      let lastErr: unknown;
      for (let attempt = 1; attempt <= this.#compRetries; attempt++) {
        const meta: StepMeta = { sagaId: state.id, step: name, idempotencyKey: `${state.id}:${name}:compensate`, attempt };
        try {
          await step.compensate(structuredClone(state.ctx), meta);
          ok = true;
          break;
        } catch (err) {
          lastErr = err;
          state.history.push(`compensate-failed:${name}`);
        }
      }
      if (!ok) {
        state.status = 'failed';
        state.error = `compensation of ${name} failed: ${errorMessage(lastErr)}`;
        await this.#store.save(state);
        return;
      }
      state.compensatedSteps.push(name);
      state.history.push(`compensate:${name}`);
      await this.#store.save(state);
    }
    state.status = 'compensated';
    await this.#store.save(state);
  }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
