import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { LoaderCache } = mod;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
/** Let pending promise callbacks run. */
const tick = async (n = 3) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
function clock(start = 10_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

/** A loader whose every call is a deferred the test settles by hand. */
function manualLoader<V>() {
  const calls: Array<{ key: string; d: Deferred<V | undefined> }> = [];
  const loader = (key: string) => {
    const d = deferred<V | undefined>();
    calls.push({ key, d });
    return d.promise;
  };
  return { loader, calls };
}

// ---------- M1: single-flight ----------

test('M1: concurrent gets for one key share a single loader call', async () => {
  const c = clock();
  const m = manualLoader<string>();
  const cache = new LoaderCache({ loader: m.loader, freshMs: 1000, now: c.now });
  const ps = Array.from({ length: 50 }, () => cache.get('user:1'));
  await tick();
  assert.equal(m.calls.length, 1);
  assert.equal(cache.inflight, 1);
  m.calls[0].d.resolve('alice');
  assert.deepEqual(await Promise.all(ps), Array(50).fill('alice'));
  assert.equal(cache.inflight, 0);
});

test('M1: different keys load independently', async () => {
  const m = manualLoader<string>();
  const cache = new LoaderCache({ loader: m.loader, freshMs: 1000, now: () => 0 });
  const a = cache.get('a');
  const b = cache.get('b');
  await tick();
  assert.deepEqual(m.calls.map((x) => x.key), ['a', 'b']);
  m.calls[1].d.resolve('B');
  m.calls[0].d.resolve('A');
  assert.equal(await a, 'A');
  assert.equal(await b, 'B');
});

test('M1: fresh values are served from cache without calling the loader', async () => {
  const c = clock();
  let calls = 0;
  const cache = new LoaderCache({ loader: async (k) => `${k}#${++calls}`, freshMs: 100, now: c.now });
  assert.equal(await cache.get('k'), 'k#1');
  c.advance(99);
  assert.equal(await cache.get('k'), 'k#1');
  assert.equal(calls, 1);
  assert.deepEqual(cache.peek('k'), { value: 'k#1', state: 'fresh' });
  c.advance(1); // staleMs = 0 → hard-expired, synchronous reload
  assert.equal(await cache.get('k'), 'k#2');
});

// ---------- M2: errors don't poison ----------

test('M2: a failed load rejects every joined waiter with the same error and is not cached', async () => {
  const m = manualLoader<string>();
  const cache = new LoaderCache({ loader: m.loader, freshMs: 1000, now: () => 0 });
  const ps = [cache.get('k'), cache.get('k'), cache.get('k')];
  await tick();
  const boom = new Error('db down');
  m.calls[0].d.reject(boom);
  const results = await Promise.allSettled(ps);
  for (const r of results) assert.deepEqual(r, { status: 'rejected', reason: boom });
  assert.equal(cache.inflight, 0);
  assert.equal(cache.peek('k'), undefined);
  const retry = cache.get('k');
  await tick();
  assert.equal(m.calls.length, 2, 'next get must call the loader again');
  m.calls[1].d.resolve('ok');
  assert.equal(await retry, 'ok');
});

test('M2: a loader that throws synchronously is handled like a rejection', async () => {
  let n = 0;
  const cache = new LoaderCache<string>({
    loader: (() => {
      if (n++ === 0) throw new Error('sync boom');
      return Promise.resolve('recovered');
    }) as (k: string) => Promise<string>,
    freshMs: 1000,
    now: () => 0,
  });
  await assert.rejects(cache.get('k'), /sync boom/);
  assert.equal(await cache.get('k'), 'recovered');
});

// ---------- M3: stale-while-revalidate ----------

test('M3: stale value is returned immediately while ONE background refresh runs', async () => {
  const c = clock();
  const m = manualLoader<string>();
  const cache = new LoaderCache({ loader: m.loader, freshMs: 100, staleMs: 1000, now: c.now });
  const first = cache.get('k');
  await tick();
  m.calls[0].d.resolve('v1');
  assert.equal(await first, 'v1');
  c.advance(150);
  assert.deepEqual(cache.peek('k'), { value: 'v1', state: 'stale' });
  const stale = await Promise.all([cache.get('k'), cache.get('k'), cache.get('k')]);
  assert.deepEqual(stale, ['v1', 'v1', 'v1'], 'stale reads must not wait for the refresh');
  await tick();
  assert.equal(m.calls.length, 2, 'exactly one background refresh');
  m.calls[1].d.resolve('v2');
  await tick();
  assert.equal(await cache.get('k'), 'v2');
  assert.deepEqual(cache.peek('k'), { value: 'v2', state: 'fresh' });
});

test('M3: a failed background refresh keeps the stale value and reports via onError', async () => {
  const c = clock();
  const m = manualLoader<string>();
  const errors: Array<[string, unknown]> = [];
  const cache = new LoaderCache({ loader: m.loader, freshMs: 100, staleMs: 1000, now: c.now, onError: (k, e) => errors.push([k, e]) });
  const p = cache.get('k');
  await tick();
  m.calls[0].d.resolve('v1');
  await p;
  c.advance(200);
  assert.equal(await cache.get('k'), 'v1');
  await tick();
  const boom = new Error('refresh failed');
  m.calls[1].d.reject(boom);
  await tick();
  assert.deepEqual(errors, [['k', boom]]);
  assert.equal(await cache.get('k'), 'v1', 'still serving stale');
  await tick();
  assert.equal(m.calls.length, 3, 'a later stale read retries the refresh');
  m.calls[2].d.resolve('v2');
  await tick();
  assert.equal(await cache.get('k'), 'v2');
});

test('M3: past the hard TTL (fresh + stale) callers wait for a synchronous reload', async () => {
  const c = clock();
  const m = manualLoader<string>();
  const cache = new LoaderCache({ loader: m.loader, freshMs: 100, staleMs: 100, now: c.now });
  const p = cache.get('k');
  await tick();
  m.calls[0].d.resolve('old');
  await p;
  c.advance(200);
  assert.equal(cache.peek('k'), undefined);
  let settled = false;
  const q = cache.get('k').then((v) => ((settled = true), v));
  await tick();
  assert.equal(settled, false, 'must not serve the expired value');
  m.calls[1].d.resolve('new');
  assert.equal(await q, 'new');
});

// ---------- M4: negative caching ----------

test('M4: undefined results are cached for negativeTtlMs only', async () => {
  const c = clock();
  let calls = 0;
  const cache = new LoaderCache<string>({ loader: async () => (calls++, undefined), freshMs: 1000, negativeTtlMs: 50, now: c.now });
  assert.equal(await cache.get('ghost'), undefined);
  assert.equal(await cache.get('ghost'), undefined);
  assert.equal(calls, 1);
  assert.deepEqual(cache.peek('ghost'), { value: undefined, state: 'negative' });
  c.advance(50);
  assert.equal(await cache.get('ghost'), undefined);
  assert.equal(calls, 2, 'negative entry expired after 50ms (not freshMs)');
});

test('M4: without negativeTtlMs, misses are not cached (but are still single-flighted)', async () => {
  const m = manualLoader<string>();
  const cache = new LoaderCache({ loader: m.loader, freshMs: 1000, now: () => 0 });
  const ps = [cache.get('x'), cache.get('x')];
  await tick();
  assert.equal(m.calls.length, 1);
  m.calls[0].d.resolve(undefined);
  assert.deepEqual(await Promise.all(ps), [undefined, undefined]);
  void cache.get('x');
  await tick();
  assert.equal(m.calls.length, 2);
  m.calls[1].d.resolve(undefined);
  await tick();
});

// ---------- M5: concurrency limit ----------

test('M5: at most maxConcurrentLoads loader calls run at once; the rest queue FIFO', async () => {
  const m = manualLoader<number>();
  const cache = new LoaderCache({ loader: m.loader, freshMs: 1000, maxConcurrentLoads: 2, now: () => 0 });
  const ps = ['a', 'b', 'c', 'd', 'a'].map((k) => cache.get(k));
  await tick();
  assert.deepEqual(m.calls.map((x) => x.key), ['a', 'b']);
  assert.equal(cache.activeLoads, 2);
  assert.equal(cache.queuedLoads, 2, 'c and d wait; the second "a" joins the in-flight load');
  assert.equal(cache.inflight, 4);
  m.calls[1].d.resolve(2); // b done → c starts
  await tick();
  assert.deepEqual(m.calls.map((x) => x.key), ['a', 'b', 'c']);
  assert.equal(cache.activeLoads, 2);
  m.calls[0].d.reject(new Error('a failed')); // failures free their slot too
  await tick();
  assert.deepEqual(m.calls.map((x) => x.key), ['a', 'b', 'c', 'd']);
  m.calls[2].d.resolve(3);
  m.calls[3].d.resolve(4);
  const r = await Promise.allSettled(ps);
  assert.deepEqual(r.map((x) => x.status), ['rejected', 'fulfilled', 'fulfilled', 'fulfilled', 'rejected']);
  assert.equal(cache.activeLoads, 0);
  assert.equal(cache.queuedLoads, 0);
});

test('M5: a 1,000-request stampede over 10 hot keys makes exactly 10 loader calls', async () => {
  let calls = 0;
  let peak = 0;
  let running = 0;
  const cache = new LoaderCache<string>({
    loader: async (k) => {
      calls++;
      peak = Math.max(peak, ++running);
      await tick(1);
      running--;
      return k.toUpperCase();
    },
    freshMs: 10_000,
    maxConcurrentLoads: 3,
    now: () => 0,
  });
  const keys = Array.from({ length: 1000 }, (_, i) => 'key' + (i % 10));
  const values = await Promise.all(keys.map((k) => cache.get(k)));
  assert.equal(calls, 10);
  assert.ok(peak <= 3, `peak concurrency ${peak}`);
  assert.equal(values[13], 'KEY3');
  assert.throws(() => new LoaderCache({ loader: async () => 1, freshMs: 1, maxConcurrentLoads: 0 }), RangeError);
});

// ---------- M6: invalidation races ----------

test('M6: invalidate during a load — old waiters get the old result, which is NOT stored; next get reloads', async () => {
  const m = manualLoader<string>();
  const cache = new LoaderCache({ loader: m.loader, freshMs: 1000, now: () => 0 });
  const before = cache.get('k');
  await tick();
  cache.invalidate('k'); // e.g. the row was updated while we were reading it
  const after = cache.get('k');
  await tick();
  assert.equal(m.calls.length, 2, 'post-invalidate get must not join the pre-invalidate flight');
  m.calls[0].d.resolve('stale-read');
  assert.equal(await before, 'stale-read');
  assert.equal(cache.peek('k'), undefined, 'the pre-invalidate result must not be cached');
  m.calls[1].d.resolve('fresh-read');
  assert.equal(await after, 'fresh-read');
  assert.equal(cache.peek('k')?.value, 'fresh-read');
});

test('M6: invalidate removes a cached value', async () => {
  let n = 0;
  const cache = new LoaderCache({ loader: async () => ++n, freshMs: 1000, now: () => 0 });
  assert.equal(await cache.get('k'), 1);
  cache.invalidate('k');
  assert.equal(cache.peek('k'), undefined);
  assert.equal(await cache.get('k'), 2);
});
