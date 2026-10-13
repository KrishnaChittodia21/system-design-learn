import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { backoffDelay, defaultIsRetryable, retry, RetryBudget, CircuitBreaker, Bulkhead, callResilient } = mod;
const { DeadlineExceededError, CircuitOpenError, BulkheadFullError } = mod;

const tick = async (n = 3) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

/** Fake clock + fake timers + a sleep that advances the clock instantly and records delays. */
function fakeEnv() {
  let t = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const sleeps: number[] = [];
  const env = {
    now: () => t,
    sleeps,
    get pendingTimers() {
      return pending.size;
    },
    timers: {
      setTimeout(fn: () => void, ms: number): unknown {
        const id = nextId++;
        pending.set(id, { at: t + ms, fn });
        return id;
      },
      clearTimeout(h: unknown) {
        pending.delete(h as number);
      },
    },
    advance(ms: number) {
      t += ms;
      for (const [id, x] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (x.at <= t) {
          pending.delete(id);
          x.fn();
        }
      }
    },
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) throw signal.reason;
      sleeps.push(ms);
      env.advance(ms);
    },
  };
  return env;
}

const transient = (msg = 'transient') => Object.assign(new Error(msg), { status: 503 });

// ---------- M1: backoff & classification ----------

test('M1: backoffDelay is full jitter over an exponentially growing, capped window', () => {
  const half = () => 0.5;
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => backoffDelay(i, 100, 10_000, half)), [50, 100, 200, 400, 800]);
  assert.equal(backoffDelay(10, 100, 1000, half), 500, 'capped at maxMs');
  assert.equal(backoffDelay(3, 100, 10_000, () => 0), 0, 'full jitter can be zero');
  assert.equal(backoffDelay(3, 100, 10_000, () => 0.9999), 799, 'floored, strictly below the cap');
});

test('M1: defaultIsRetryable accepts only transient failures', () => {
  const cases: Array<[unknown, boolean]> = [
    [{ status: 503 }, true],
    [{ status: 429 }, true],
    [{ status: 408 }, true],
    [{ status: 500 }, true],
    [{ status: 400 }, false],
    [{ status: 404 }, false],
    [{ status: 501 }, false],
    [{ code: 'ECONNRESET' }, true],
    [{ code: 'ETIMEDOUT' }, true],
    [{ code: 'ENOENT' }, false],
    [{ retryable: true, status: 400 }, true],
    [{ retryable: false, status: 503 }, false],
    [new Error('plain'), false],
    ['string error', false],
    [null, false],
  ];
  for (const [err, want] of cases) assert.equal(defaultIsRetryable(err), want, JSON.stringify(err));
});

// ---------- M2: retry ----------

test('M2: retries transient failures with backoff and returns the eventual success', async () => {
  const env = fakeEnv();
  const attempts: number[] = [];
  const retries: Array<[number, number]> = [];
  const result = await retry(
    async (attempt) => {
      attempts.push(attempt);
      if (attempt < 2) throw transient();
      return 'ok';
    },
    { maxAttempts: 5, baseDelayMs: 100, random: () => 0.5, sleep: env.sleep, now: env.now, timers: env.timers, onRetry: (i) => retries.push([i.attempt, i.delayMs]) },
  );
  assert.equal(result, 'ok');
  assert.deepEqual(attempts, [0, 1, 2]);
  assert.deepEqual(env.sleeps, [50, 100]);
  assert.deepEqual(retries, [[0, 50], [1, 100]]);
});

test('M2: non-retryable errors are rethrown immediately, unwrapped', async () => {
  const env = fakeEnv();
  let calls = 0;
  const bad = Object.assign(new Error('bad request'), { status: 400 });
  await assert.rejects(
    retry(async () => {
      calls++;
      throw bad;
    }, { sleep: env.sleep, now: env.now, timers: env.timers }),
    (e) => e === bad,
  );
  assert.equal(calls, 1);
  assert.deepEqual(env.sleeps, []);
});

test('M2: gives up after maxAttempts with the last error; delays respect maxDelayMs', async () => {
  const env = fakeEnv();
  let calls = 0;
  await assert.rejects(
    retry(async () => {
      throw transient('fail #' + ++calls);
    }, { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 300, random: () => 0.999, sleep: env.sleep, now: env.now, timers: env.timers }),
    /fail #5/,
  );
  assert.equal(calls, 5);
  assert.deepEqual(env.sleeps, [99, 199, 299, 299]);
});

test('M2: custom isRetryable and injected randomness are honoured', async () => {
  const env = fakeEnv();
  const rs = [0, 0.25, 0.75];
  let calls = 0;
  await assert.rejects(
    retry(async () => {
      calls++;
      throw new Error('custom');
    }, { maxAttempts: 4, baseDelayMs: 100, random: () => rs.shift()!, isRetryable: (e) => (e as Error).message === 'custom', sleep: env.sleep, now: env.now, timers: env.timers }),
  );
  assert.equal(calls, 4);
  assert.deepEqual(env.sleeps, [0, 50, 300]);
});

// ---------- M3: deadlines & cancellation ----------

test('M3: a hung attempt is abandoned at the deadline; its signal is aborted', async () => {
  const env = fakeEnv();
  let seen: AbortSignal | undefined;
  const p = retry((_a, signal) => {
    seen = signal;
    return new Promise(() => {}); // ignores the signal and never settles
  }, { deadlineMs: 1000, sleep: env.sleep, now: env.now, timers: env.timers });
  await tick();
  env.advance(999);
  await tick();
  assert.equal(seen!.aborted, false);
  env.advance(1);
  await assert.rejects(p, DeadlineExceededError);
  assert.equal(seen!.aborted, true);
  assert.ok(seen!.reason instanceof DeadlineExceededError);
});

test('M3: does not start a backoff sleep that would cross the deadline', async () => {
  const env = fakeEnv();
  const err = transient();
  let calls = 0;
  await assert.rejects(
    retry(async () => {
      calls++;
      env.advance(900); // slow failure
      throw err;
    }, { deadlineMs: 1000, maxAttempts: 10, baseDelayMs: 400, random: () => 0.5, sleep: env.sleep, now: env.now, timers: env.timers }),
    (e) => e instanceof DeadlineExceededError && (e as Error).cause === err,
  );
  assert.equal(calls, 1);
  assert.deepEqual(env.sleeps, []);
});

test('M3: deadline timers are cleared once attempts settle', async () => {
  const env = fakeEnv();
  await retry(async (a) => {
    if (a === 0) throw transient();
    return 1;
  }, { deadlineMs: 60_000, random: () => 0, sleep: env.sleep, now: env.now, timers: env.timers });
  assert.equal(env.pendingTimers, 0);
});

test('M3: caller abort during an attempt rejects with signal.reason and aborts the attempt', async () => {
  const env = fakeEnv();
  const ac = new AbortController();
  let seen: AbortSignal | undefined;
  const p = retry((_a, signal) => {
    seen = signal;
    return new Promise(() => {});
  }, { signal: ac.signal, sleep: env.sleep, now: env.now, timers: env.timers });
  await tick();
  const reason = new Error('user navigated away');
  ac.abort(reason);
  await assert.rejects(p, (e) => e === reason);
  assert.equal(seen!.aborted, true);
});

test('M3: caller abort during backoff sleep stops retrying; an already-aborted signal never calls fn', async () => {
  const ac = new AbortController();
  let calls = 0;
  const sleep = (_ms: number, signal?: AbortSignal) =>
    new Promise<void>((_res, rej) => signal?.addEventListener('abort', () => rej(signal.reason), { once: true }));
  const p = retry(async () => {
    calls++;
    throw transient();
  }, { signal: ac.signal, sleep, maxAttempts: 5 });
  await tick();
  ac.abort(new Error('cancel'));
  await assert.rejects(p, /cancel/);
  assert.equal(calls, 1);

  let called = false;
  await assert.rejects(
    retry(async () => {
      called = true;
      return 1;
    }, { signal: AbortSignal.abort(new Error('too late')) }),
    /too late/,
  );
  assert.equal(called, false);
});

// ---------- M4: retry budget ----------

test('M4: RetryBudget deposits ratio per request, withdraws 1 per retry, caps at max', () => {
  const b = new RetryBudget({ ratio: 0.5, initial: 0, max: 2 });
  assert.equal(b.tryWithdraw(), false);
  b.recordRequest();
  assert.equal(b.tryWithdraw(), false);
  b.recordRequest();
  assert.equal(b.tokens, 1);
  assert.equal(b.tryWithdraw(), true);
  assert.equal(b.tokens, 0);
  for (let i = 0; i < 10; i++) b.recordRequest();
  assert.equal(b.tokens, 2);
});

test('M4: an exhausted budget stops retries and surfaces the last error', async () => {
  const env = fakeEnv();
  const budget = new RetryBudget({ ratio: 0, initial: 1 });
  let calls = 0;
  const run = () =>
    retry(async () => {
      calls++;
      throw transient('down');
    }, { maxAttempts: 5, budget, random: () => 0, sleep: env.sleep, now: env.now, timers: env.timers });
  await assert.rejects(run(), /down/);
  assert.equal(calls, 2, 'one token → one retry');
  calls = 0;
  await assert.rejects(run(), /down/);
  assert.equal(calls, 1, 'no tokens → no retries (retry storm prevented)');
});

// ---------- M5: circuit breaker ----------

test('M5: opens after N consecutive failures; a success resets the count', async () => {
  const env = fakeEnv();
  const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000, now: env.now });
  const fail = () => cb.execute(async () => {
    throw new Error('x');
  });
  await assert.rejects(fail());
  await assert.rejects(fail());
  assert.equal(await cb.execute(async () => 'ok'), 'ok');
  await assert.rejects(fail());
  await assert.rejects(fail());
  assert.equal(cb.state, 'closed');
  await assert.rejects(fail());
  assert.equal(cb.state, 'open');
});

test('M5: open circuit fails fast without calling fn and reports retryAfterMs', async () => {
  const env = fakeEnv();
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, now: env.now });
  await assert.rejects(cb.execute(async () => {
    throw new Error('x');
  }));
  env.advance(300);
  let called = false;
  await assert.rejects(
    cb.execute(async () => {
      called = true;
    }),
    (e) => e instanceof CircuitOpenError && e.retryAfterMs === 700,
  );
  assert.equal(called, false);
  env.advance(700);
  assert.equal(cb.state, 'half-open');
});

test('M5: half-open admits a limited number of concurrent probes; success closes', async () => {
  const env = fakeEnv();
  const changes: string[] = [];
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 100, halfOpenMaxProbes: 1, now: env.now, onStateChange: (f, t) => changes.push(`${f}->${t}`) });
  await assert.rejects(cb.execute(async () => {
    throw new Error('x');
  }));
  env.advance(100);
  const d = deferred<string>();
  const probe = cb.execute(() => d.promise);
  await assert.rejects(cb.execute(async () => 'second'), CircuitOpenError);
  d.resolve('healthy');
  assert.equal(await probe, 'healthy');
  assert.equal(cb.state, 'closed');
  assert.deepEqual(changes, ['closed->open', 'open->half-open', 'half-open->closed']);
});

test('M5: a failed probe re-opens the circuit and restarts the timer; successThreshold needs N probe successes', async () => {
  const env = fakeEnv();
  const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 100, successThreshold: 2, now: env.now });
  const boom = async () => {
    throw new Error('x');
  };
  await assert.rejects(cb.execute(boom));
  env.advance(100);
  await assert.rejects(cb.execute(boom), /x/);
  assert.equal(cb.state, 'open');
  env.advance(99);
  assert.equal(cb.state, 'open', 'timer restarted at the failed probe');
  env.advance(1);
  await cb.execute(async () => 1);
  assert.equal(cb.state, 'half-open', 'one success is not enough');
  await cb.execute(async () => 2);
  assert.equal(cb.state, 'closed');
});

test('M5: errors excluded by isFailure (e.g. 4xx) do not trip the breaker', async () => {
  const cb = new CircuitBreaker({ failureThreshold: 2, now: () => 0, isFailure: (e) => (e as { status?: number }).status !== 404 });
  for (let i = 0; i < 5; i++) {
    await assert.rejects(cb.execute(async () => {
      throw Object.assign(new Error('nf'), { status: 404 });
    }), /nf/);
  }
  assert.equal(cb.state, 'closed');
});

// ---------- M6: bulkhead ----------

test('M6: bulkhead caps concurrency, queues FIFO up to maxQueue, rejects beyond', async () => {
  const bh = new Bulkhead({ maxConcurrent: 2, maxQueue: 1 });
  const ds = [deferred<number>(), deferred<number>(), deferred<number>()];
  const started: number[] = [];
  const run = (i: number) => bh.execute(() => (started.push(i), ds[i].promise));
  const p0 = run(0);
  const p1 = run(1);
  const p2 = run(2);
  await tick();
  assert.deepEqual(started, [0, 1]);
  assert.equal(bh.active, 2);
  assert.equal(bh.queued, 1);
  let called = false;
  await assert.rejects(bh.execute(async () => (called = true)), BulkheadFullError);
  assert.equal(called, false);
  ds[0].reject(new Error('fails still free the slot'));
  await assert.rejects(p0);
  await tick();
  assert.deepEqual(started, [0, 1, 2]);
  ds[1].resolve(1);
  ds[2].resolve(2);
  assert.deepEqual(await Promise.all([p1, p2]), [1, 2]);
  assert.equal(bh.active, 0);
  assert.throws(() => new Bulkhead({ maxConcurrent: 0 }), RangeError);
});

// ---------- M7: composition ----------

test('M7: callResilient never retries an open circuit', async () => {
  const env = fakeEnv();
  const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 10_000, now: env.now });
  let calls = 0;
  await assert.rejects(
    callResilient(async () => {
      calls++;
      throw transient();
    }, { breaker: cb, retry: { maxAttempts: 10, random: () => 0, sleep: env.sleep, now: env.now, timers: env.timers } }),
    CircuitOpenError,
  );
  assert.equal(calls, 2);
  assert.equal(env.sleeps.length, 2);
  assert.equal(cb.state, 'open');
});

test('M7: callResilient holds one bulkhead slot across all retries of a call', async () => {
  const env = fakeEnv();
  const bh = new Bulkhead({ maxConcurrent: 1 });
  const gate = deferred<void>();
  let attempts = 0;
  const p = callResilient(async (attempt) => {
    attempts++;
    if (attempt === 0) throw transient();
    await gate.promise;
    return 'done';
  }, { bulkhead: bh, retry: { random: () => 0, sleep: env.sleep, now: env.now, timers: env.timers } });
  await tick();
  assert.equal(bh.active, 1);
  await assert.rejects(callResilient(async () => 'other', { bulkhead: bh }), BulkheadFullError);
  gate.resolve();
  assert.equal(await p, 'done');
  assert.equal(attempts, 2);
  assert.equal(bh.active, 0);
});
