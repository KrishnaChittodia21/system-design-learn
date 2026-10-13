# Build Idempotency Keys + an Orchestrated Saga

You will build two production patterns in one TypeScript file (`src/index.ts`):

1. **Idempotency keys** — `IdempotencyStore` + `handleIdempotent`, the server side of Stripe's `Idempotency-Key` header.
2. **An orchestrated saga** — `SagaOrchestrator`, a small workflow engine with persisted state, retries, compensations, crash-resume and a pivot step.

The judge is `test/idempotency-saga.test.ts` (21 tests). Read it: each test name says which behaviour it checks.

## Run it

```bash
npm run project -- idempotency-saga             # judge YOUR code (saves results for the app)
npm run project -- idempotency-saga --no-save   # judge without saving
npm run project -- idempotency-saga --solution  # run the reference solution
```

## Part 1 — idempotency keys

| Situation | Response |
|---|---|
| no key | `400`, handler not run |
| new key | run handler, store response, `replayed: false` |
| same key, first request still running | `409` |
| same key, completed | stored response, `replayed: true` |
| same key, **different payload** | `422` |
| handler throws | release the lock, rethrow (the client may retry) |
| completed record older than `ttlMs` | treated as new |
| in-progress lock older than `lockTtlMs` | treated as new (the first worker crashed) |

- `fingerprint(payload)` must not depend on object key order, but must depend on array order.
- `begin()` is **synchronous**. It is the atomic "insert if absent". If you make it async, two concurrent requests can both see "absent".
- Store and replay **copies**. A caller that mutates the returned body must not change later replays.
- Deterministic results such as a `402 card declined` are stored and replayed too. The stored response is the result of the request, whatever its status.

## Part 2 — orchestrated saga

```ts
const saga = new SagaOrchestrator<OrderCtx>({ steps, store, compensationRetries: 3, forwardRetries: 5 });
await saga.start('order-42', { orderId: 'order-42', amount: 500 });
// after a crash, in a new process:
await saga.resume('order-42');
```

Rules:
- **Persist after every transition** (creation, each completed step, each status change, each completed compensation). Errors thrown by `store.save` mean the process crashed. Don't catch them; put only the step's own code inside your `try`.
- Steps get `(retries ?? 0) + 1` attempts. `meta.idempotencyKey` is `${sagaId}:${step}`. It stays the same across retries and resumes, so downstream services can dedupe.
- When a step fails **before the pivot**, set `status = 'compensating'` and compensate the completed steps in **reverse** order. Don't compensate the failed step itself. If a compensation fails `compensationRetries` times, the status becomes `'failed'`. If all succeed, it becomes `'compensated'`.
- The **pivot** is the point of no return, such as "charge card" or "send to the warehouse". After it succeeds, each later step gets `max(forwardRetries, retries + 1)` attempts and is never compensated. If those attempts run out, the status becomes `'failed'`.
- `resume` continues a `running` or `compensating` saga. A step that ran but wasn't persisted runs again, which is why steps must be idempotent. Terminal sagas are returned as they are.

## Hints

- Write `#forward(state)` and `#backward(state)` as two loops over persisted state. Then "resume" is just calling them again.
- `structuredClone` is your friend for copy-on-save and copy-on-load.
- Draw the save count for the crash tests: initial save, then one save per step. The tests crash on a specific save number.

## Stretch goals

- Back the idempotency store with SQLite or Postgres (`INSERT ... ON CONFLICT DO NOTHING RETURNING`) and the saga store with an outbox table.
- Add exponential backoff with an injected scheduler, and a `deadline` per saga.
- Run parallel branches: steps that don't depend on each other run concurrently, and compensation waits for the in-flight ones.
- Turn it into a **choreographed** saga with events and compare the two designs: where does the state live, and who knows the whole flow?
