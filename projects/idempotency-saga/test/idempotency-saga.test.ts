import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { IdempotencyStore, handleIdempotent, fingerprint, SagaOrchestrator, InMemorySagaStore } = mod;
type SagaState<C> = import('../solution/index.ts').SagaState<C>;
type SagaStore<C> = import('../solution/index.ts').SagaStore<C>;
type SagaStep<C> = import('../solution/index.ts').SagaStep<C>;

function fakeClock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

/** A promise you resolve from the outside, to hold a handler "in flight". */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

// ---------------------------------------------------------------- idempotency

test('M1: fingerprint ignores object key order but not values', () => {
  assert.equal(fingerprint({ amount: 100, currency: 'INR', meta: { a: 1, b: [1, 2] } }), fingerprint({ meta: { b: [1, 2], a: 1 }, currency: 'INR', amount: 100 }));
  assert.notEqual(fingerprint({ amount: 100 }), fingerprint({ amount: 101 }));
  assert.notEqual(fingerprint({ items: [1, 2] }), fingerprint({ items: [2, 1] }), 'array order matters');
});

test('M1: first request runs the handler and returns its response', async () => {
  const store = new IdempotencyStore({ ttlMs: 60_000, now: fakeClock().now });
  let calls = 0;
  const res = await handleIdempotent(store, 'k1', { amount: 5 }, async () => { calls++; return { status: 201, body: { id: 'pay_1' } }; });
  assert.equal(calls, 1);
  assert.deepEqual(res, { status: 201, body: { id: 'pay_1' }, replayed: false });
  assert.equal(store.get('k1')?.status, 'completed');
});

test('M2: a completed duplicate replays the stored response without re-running the handler', async () => {
  const store = new IdempotencyStore({ ttlMs: 60_000, now: fakeClock().now });
  let calls = 0;
  const handler = async () => { calls++; return { status: 201, body: { id: `pay_${calls}` } }; };
  await handleIdempotent(store, 'k1', { amount: 5 }, handler);
  const again = await handleIdempotent(store, 'k1', { amount: 5 }, handler);
  assert.equal(calls, 1);
  assert.deepEqual(again, { status: 201, body: { id: 'pay_1' }, replayed: true });
});

test('M2: stored responses are copies — mutating a returned body does not change later replays', async () => {
  const store = new IdempotencyStore({ ttlMs: 60_000, now: fakeClock().now });
  const first = await handleIdempotent(store, 'k', {}, async () => ({ status: 200, body: { n: 1 } }));
  (first.body as { n: number }).n = 999;
  const replay = await handleIdempotent(store, 'k', {}, async () => ({ status: 200, body: { n: 2 } }));
  assert.deepEqual(replay.body, { n: 1 });
});

test('M2: a concurrent duplicate gets 409 while the first request is in flight; handler runs once', async () => {
  const store = new IdempotencyStore({ ttlMs: 60_000, now: fakeClock().now });
  const gate = deferred<void>();
  let calls = 0;
  const handler = async () => { calls++; await gate.promise; return { status: 201, body: { ok: true } }; };
  const first = handleIdempotent(store, 'k1', { a: 1 }, handler);
  const dup = await handleIdempotent(store, 'k1', { a: 1 }, handler);
  assert.equal(dup.status, 409);
  assert.equal(store.get('k1')?.status, 'in_progress');
  gate.resolve();
  assert.equal((await first).status, 201);
  assert.equal(calls, 1);
  assert.equal((await handleIdempotent(store, 'k1', { a: 1 }, handler)).replayed, true);
});

test('M3: same key with a different payload is rejected with 422 (in progress and completed)', async () => {
  const store = new IdempotencyStore({ ttlMs: 60_000, now: fakeClock().now });
  const gate = deferred<void>();
  const first = handleIdempotent(store, 'k1', { amount: 5 }, async () => { await gate.promise; return { status: 201, body: {} }; });
  const during = await handleIdempotent(store, 'k1', { amount: 6 }, async () => ({ status: 201, body: {} }));
  assert.equal(during.status, 422);
  gate.resolve();
  await first;
  let ran = false;
  const after = await handleIdempotent(store, 'k1', { amount: 6 }, async () => { ran = true; return { status: 201, body: {} }; });
  assert.equal(after.status, 422);
  assert.equal(ran, false);
});

test('M3: a missing idempotency key is a 400 and the handler does not run', async () => {
  const store = new IdempotencyStore({ ttlMs: 1000 });
  let ran = false;
  const res = await handleIdempotent(store, undefined, {}, async () => { ran = true; return { status: 200, body: {} }; });
  assert.equal(res.status, 400);
  assert.equal(ran, false);
});

test('M3: if the handler throws, the lock is released so a retry can run', async () => {
  const store = new IdempotencyStore({ ttlMs: 60_000, now: fakeClock().now });
  let calls = 0;
  const handler = async () => { calls++; if (calls === 1) throw new Error('db timeout'); return { status: 201, body: { attempt: calls } }; };
  await assert.rejects(handleIdempotent(store, 'k1', { a: 1 }, handler), /db timeout/);
  assert.equal(store.get('k1'), undefined);
  const res = await handleIdempotent(store, 'k1', { a: 1 }, handler);
  assert.deepEqual(res, { status: 201, body: { attempt: 2 }, replayed: false });
});

test('M3: a deterministic 4xx result is stored and replayed like any other response', async () => {
  const store = new IdempotencyStore({ ttlMs: 60_000, now: fakeClock().now });
  let calls = 0;
  const handler = async () => { calls++; return { status: 402, body: { error: 'card declined' } }; };
  await handleIdempotent(store, 'k1', {}, handler);
  const again = await handleIdempotent(store, 'k1', {}, handler);
  assert.equal(calls, 1);
  assert.equal(again.status, 402);
  assert.equal(again.replayed, true);
});

test('M4: completed records expire after ttlMs; in-progress locks expire after lockTtlMs', async () => {
  const clock = fakeClock();
  const store = new IdempotencyStore({ ttlMs: 10_000, lockTtlMs: 2_000, now: clock.now });
  let calls = 0;
  const handler = async () => { calls++; return { status: 200, body: { calls } }; };
  await handleIdempotent(store, 'k1', {}, handler);
  clock.advance(9_999);
  assert.equal((await handleIdempotent(store, 'k1', {}, handler)).replayed, true);
  clock.advance(1);
  const fresh = await handleIdempotent(store, 'k1', {}, handler);
  assert.equal(fresh.replayed, false);
  assert.equal(calls, 2);

  // A worker took the lock and crashed (never completed): retries get 409 until the lease ends.
  assert.deepEqual(store.begin('k2', 'fp'), { kind: 'started' });
  clock.advance(1_999);
  assert.deepEqual(store.begin('k2', 'fp'), { kind: 'in_progress' });
  clock.advance(1);
  assert.deepEqual(store.begin('k2', 'fp'), { kind: 'started' });
});

// ---------------------------------------------------------------- saga

interface OrderCtx { orderId: string; amount: number; reservationId?: string; paymentId?: string; shipmentId?: string }

/** Fake downstream services that dedupe on the idempotency key, like real ones should. */
function services() {
  const log: string[] = [];
  const charges = new Map<string, string>();
  let chargeEffects = 0;
  return {
    log,
    charges,
    get chargeEffects() { return chargeEffects; },
    charge(key: string): string {
      const existing = charges.get(key);
      if (existing) return existing;
      chargeEffects++;
      const id = `pay_${chargeEffects}`;
      charges.set(key, id);
      return id;
    },
  };
}

function orderSteps(svc: ReturnType<typeof services>, opts: { failAt?: string; pivotAt?: string } = {}): SagaStep<OrderCtx>[] {
  const mk = (name: string, field: keyof OrderCtx, run?: (key: string) => string): SagaStep<OrderCtx> => ({
    name,
    pivot: opts.pivotAt === name,
    action: async (_ctx, meta) => {
      svc.log.push(`do:${name}`);
      if (opts.failAt === name) throw new Error(`${name} failed`);
      return { [field]: run ? run(meta.idempotencyKey) : `${name}_1` } as Partial<OrderCtx>;
    },
    compensate: async (ctx) => { svc.log.push(`undo:${name}:${String(ctx[field])}`); },
  });
  return [
    { name: 'validate', action: async () => { svc.log.push('do:validate'); } },
    mk('reserve', 'reservationId'),
    mk('charge', 'paymentId', (k) => svc.charge(k)),
    mk('ship', 'shipmentId'),
  ];
}

test('M5: happy path runs steps in order, merges ctx patches and persists a completed state', async () => {
  const svc = services();
  const store = new InMemorySagaStore<OrderCtx>();
  const saga = new SagaOrchestrator<OrderCtx>({ steps: orderSteps(svc), store });
  const res = await saga.start('o1', { orderId: 'o1', amount: 500 });
  assert.equal(res.status, 'completed');
  assert.deepEqual(svc.log, ['do:validate', 'do:reserve', 'do:charge', 'do:ship']);
  assert.deepEqual(res.completedSteps, ['validate', 'reserve', 'charge', 'ship']);
  assert.deepEqual(res.ctx, { orderId: 'o1', amount: 500, reservationId: 'reserve_1', paymentId: 'pay_1', shipmentId: 'ship_1' });
  assert.deepEqual(await store.load('o1'), res);
});

test('M5: a failing step triggers compensation of completed steps in reverse order', async () => {
  const svc = services();
  const saga = new SagaOrchestrator<OrderCtx>({ steps: orderSteps(svc, { failAt: 'ship' }), store: new InMemorySagaStore() });
  const res = await saga.start('o1', { orderId: 'o1', amount: 500 });
  assert.equal(res.status, 'compensated');
  assert.equal(res.error, 'ship failed');
  // the failed step itself is NOT compensated; validate has no compensation
  assert.deepEqual(svc.log, ['do:validate', 'do:reserve', 'do:charge', 'do:ship', 'undo:charge:pay_1', 'undo:reserve:reserve_1']);
  assert.deepEqual(res.compensatedSteps.filter((s) => s !== 'validate'), ['charge', 'reserve']);
});

test('M5: step retries reuse the same idempotency key and report the attempt number', async () => {
  const seen: Array<[string, number]> = [];
  const steps: SagaStep<{ n: number }>[] = [
    {
      name: 'flaky',
      retries: 2,
      action: async (_ctx, meta) => {
        seen.push([meta.idempotencyKey, meta.attempt]);
        if (meta.attempt < 3) throw new Error('503');
        return { n: 1 };
      },
    },
  ];
  const res = await new SagaOrchestrator({ steps, store: new InMemorySagaStore<{ n: number }>() }).start('s1', { n: 0 });
  assert.equal(res.status, 'completed');
  assert.deepEqual(seen, [['s1:flaky', 1], ['s1:flaky', 2], ['s1:flaky', 3]]);
});

/** Wraps a store and throws ("the process died") on the Nth save. */
class CrashingStore<C> implements SagaStore<C> {
  inner: SagaStore<C>;
  saves = 0;
  crashAt: number;
  constructor(inner: SagaStore<C>, crashAt: number) { this.inner = inner; this.crashAt = crashAt; }
  load(id: string) { return this.inner.load(id); }
  async save(s: SagaState<C>) {
    this.saves++;
    if (this.saves === this.crashAt) throw new Error('CRASH');
    return this.inner.save(s);
  }
}

test('M6: a crash after a step ran but before it was persisted resumes without a duplicate side effect', async () => {
  const svc = services();
  const durable = new InMemorySagaStore<OrderCtx>();
  // save #1 = initial state, #2 = after validate, #3 = after reserve, #4 = after charge → crash
  const crashing = new CrashingStore(durable, 4);
  await assert.rejects(new SagaOrchestrator<OrderCtx>({ steps: orderSteps(svc), store: crashing }).start('o1', { orderId: 'o1', amount: 1 }), /CRASH/);
  assert.equal(svc.chargeEffects, 1);
  const persisted = await durable.load('o1');
  assert.equal(persisted?.status, 'running');
  assert.deepEqual(persisted?.completedSteps, ['validate', 'reserve']);

  // A new process picks it up.
  const res = await new SagaOrchestrator<OrderCtx>({ steps: orderSteps(svc), store: durable }).resume('o1');
  assert.equal(res.status, 'completed');
  assert.equal(svc.chargeEffects, 1, 'charge must be deduplicated by its idempotency key');
  assert.equal(res.ctx.paymentId, 'pay_1');
  assert.deepEqual(svc.log.filter((l) => l === 'do:reserve'), ['do:reserve'], 'completed steps are not re-run');
});

test('M6: a crash mid-compensation resumes compensating without repeating finished undos', async () => {
  const svc = services();
  const durable = new InMemorySagaStore<OrderCtx>();
  // saves: 1 init, 2 validate, 3 reserve, 4 charge, 5 ship-failed→compensating, 6 after undo charge, 7 after undo reserve → crash
  const crashing = new CrashingStore(durable, 7);
  await assert.rejects(new SagaOrchestrator<OrderCtx>({ steps: orderSteps(svc, { failAt: 'ship' }), store: crashing }).start('o1', { orderId: 'o1', amount: 1 }), /CRASH/);
  assert.equal((await durable.load('o1'))?.status, 'compensating');
  const res = await new SagaOrchestrator<OrderCtx>({ steps: orderSteps(svc, { failAt: 'ship' }), store: durable }).resume('o1');
  assert.equal(res.status, 'compensated');
  assert.equal(svc.log.filter((l) => l.startsWith('undo:charge')).length, 1);
  // reserve's undo ran before the crash was persisted, so it runs again — compensations must be idempotent too
  assert.equal(svc.log.filter((l) => l.startsWith('undo:reserve')).length, 2);
  assert.equal(svc.log.filter((l) => l === 'do:ship').length, 1, 'no forward steps after compensation began');
});

test('M6: start() with an existing saga id does not restart it', async () => {
  const svc = services();
  const store = new InMemorySagaStore<OrderCtx>();
  const saga = new SagaOrchestrator<OrderCtx>({ steps: orderSteps(svc), store });
  await saga.start('o1', { orderId: 'o1', amount: 1 });
  const again = await saga.start('o1', { orderId: 'o1', amount: 999 });
  assert.equal(again.status, 'completed');
  assert.equal(again.ctx.amount, 1);
  assert.equal(svc.log.length, 4);
  await assert.rejects(saga.resume('nope'), /unknown saga/);
});

test('M7: after the pivot step, failures are retried forward and never compensated', async () => {
  const log: string[] = [];
  let shipAttempts = 0;
  const steps: SagaStep<{ x: number }>[] = [
    { name: 'reserve', action: async () => { log.push('do:reserve'); }, compensate: async () => { log.push('undo:reserve'); } },
    { name: 'charge', pivot: true, action: async () => { log.push('do:charge'); }, compensate: async () => { log.push('undo:charge'); } },
    { name: 'ship', action: async () => { shipAttempts++; if (shipAttempts < 4) throw new Error('courier down'); log.push('do:ship'); } },
  ];
  const res = await new SagaOrchestrator({ steps, store: new InMemorySagaStore<{ x: number }>(), forwardRetries: 5 }).start('s', { x: 0 });
  assert.equal(res.status, 'completed');
  assert.equal(res.pivotPassed, true);
  assert.equal(shipAttempts, 4);
  assert.deepEqual(log, ['do:reserve', 'do:charge', 'do:ship']);
});

test('M7: exhausting forward retries after the pivot marks the saga failed, with no compensation', async () => {
  const log: string[] = [];
  const steps: SagaStep<{ x: number }>[] = [
    { name: 'reserve', action: async () => { log.push('do:reserve'); }, compensate: async () => { log.push('undo:reserve'); } },
    { name: 'charge', pivot: true, action: async () => { log.push('do:charge'); }, compensate: async () => { log.push('undo:charge'); } },
    { name: 'ship', action: async () => { log.push('try:ship'); throw new Error('courier down'); } },
  ];
  const res = await new SagaOrchestrator({ steps, store: new InMemorySagaStore<{ x: number }>(), forwardRetries: 3 }).start('s', { x: 0 });
  assert.equal(res.status, 'failed');
  assert.deepEqual(log, ['do:reserve', 'do:charge', 'try:ship', 'try:ship', 'try:ship']);
  assert.deepEqual(res.compensatedSteps, []);
});

test('M7: if the pivot itself fails, the steps before it are compensated', async () => {
  const svc = services();
  const res = await new SagaOrchestrator<OrderCtx>({ steps: orderSteps(svc, { failAt: 'charge', pivotAt: 'charge' }), store: new InMemorySagaStore() }).start('o', { orderId: 'o', amount: 1 });
  assert.equal(res.status, 'compensated');
  assert.equal(res.pivotPassed, false);
  assert.deepEqual(svc.log.slice(-1), ['undo:reserve:reserve_1']);
});

test('M7: a compensation that keeps failing marks the saga failed (needs a human)', async () => {
  let undoAttempts = 0;
  const steps: SagaStep<{ x: number }>[] = [
    { name: 'a', action: async () => {}, compensate: async () => { undoAttempts++; throw new Error('refund API down'); } },
    { name: 'b', action: async () => { throw new Error('boom'); } },
  ];
  const res = await new SagaOrchestrator({ steps, store: new InMemorySagaStore<{ x: number }>(), compensationRetries: 2 }).start('s', { x: 0 });
  assert.equal(res.status, 'failed');
  assert.equal(undoAttempts, 2);
  assert.match(res.error ?? '', /refund API down/);
});

test('M7: the orchestrator rejects duplicate step names and multiple pivots', () => {
  const store = new InMemorySagaStore<{ x: number }>();
  const a = { name: 'a', action: async () => {} };
  new SagaOrchestrator({ steps: [a, { name: 'b', pivot: true, action: async () => {} }], store }); // valid: must not throw
  assert.throws(() => new SagaOrchestrator({ steps: [a, { ...a }], store }));
  assert.throws(() => new SagaOrchestrator({ steps: [{ ...a, pivot: true }, { name: 'b', pivot: true, action: async () => {} }], store }));
});
