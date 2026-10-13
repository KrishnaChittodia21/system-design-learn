import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { TokenBucket, SlidingWindowCounter, RateLimiter, retryAfterHeader } = mod;

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms), set: (ms: number) => (t = ms) };
}

// ---------- M1: token bucket ----------

test('M1: token bucket allows a burst up to capacity, then denies', () => {
  const c = clock();
  const tb = new TokenBucket({ capacity: 3, refillPerSecond: 1, now: c.now });
  assert.deepEqual(tb.consume('u'), { allowed: true, remaining: 2, retryAfterMs: 0 });
  assert.equal(tb.consume('u').remaining, 1);
  assert.equal(tb.consume('u').remaining, 0);
  const d = tb.consume('u');
  assert.equal(d.allowed, false);
  assert.equal(d.remaining, 0);
  assert.equal(d.retryAfterMs, 1000);
});

test('M1: token bucket refills continuously and never above capacity', () => {
  const c = clock();
  const tb = new TokenBucket({ capacity: 5, refillPerSecond: 10, now: c.now });
  for (let i = 0; i < 5; i++) tb.consume('u');
  assert.equal(tb.check('u').allowed, false);
  c.advance(250); // +2.5 tokens
  assert.equal(tb.consume('u', 2).allowed, true);
  assert.equal(tb.consume('u').allowed, false);
  assert.equal(tb.consume('u').retryAfterMs, 50); // needs 0.5 more token at 10/s
  c.advance(60_000);
  assert.equal(tb.check('u').remaining, 4, 'capped at capacity (5 - 1)');
});

test('M1: retryAfterMs is exact — denied 1 ms before, allowed at that time', () => {
  const c = clock();
  const tb = new TokenBucket({ capacity: 4, refillPerSecond: 3, now: c.now });
  tb.consume('u', 4);
  const d = tb.consume('u', 2);
  assert.equal(d.allowed, false);
  assert.equal(d.retryAfterMs, 667);
  c.advance(d.retryAfterMs - 1);
  assert.equal(tb.check('u', 2).allowed, false);
  c.advance(1);
  assert.equal(tb.consume('u', 2).allowed, true);
});

test('M1: check never charges or creates state; a denied consume does not charge', () => {
  const c = clock();
  const tb = new TokenBucket({ capacity: 2, refillPerSecond: 1, now: c.now });
  for (let i = 0; i < 10; i++) assert.equal(tb.check('a').allowed, true);
  assert.equal(tb.size, 0);
  tb.consume('a', 2);
  assert.equal(tb.consume('a', 1).allowed, false);
  c.advance(1000);
  assert.equal(tb.consume('a', 1).allowed, true, 'the denied request must not have been charged');
});

test('M1: keys are independent; cost > capacity is never allowed; invalid input throws', () => {
  const c = clock();
  const tb = new TokenBucket({ capacity: 2, refillPerSecond: 1, now: c.now });
  tb.consume('a', 2);
  assert.equal(tb.consume('b', 2).allowed, true);
  const big = tb.consume('c', 3);
  assert.equal(big.allowed, false);
  assert.equal(big.retryAfterMs, Infinity);
  assert.throws(() => tb.consume('a', 0), RangeError);
  assert.throws(() => tb.consume('a', -1), RangeError);
  assert.throws(() => new TokenBucket({ capacity: 0, refillPerSecond: 1 }), RangeError);
  assert.throws(() => new TokenBucket({ capacity: 1, refillPerSecond: 0 }), RangeError);
});

// ---------- M2: sliding-window counter ----------

test('M2: sliding window allows `limit` requests in a window and denies the next', () => {
  const c = clock(10_000); // exactly at a window boundary (windowMs = 1000)
  const sw = new SlidingWindowCounter({ limit: 3, windowMs: 1000, now: c.now });
  assert.equal(sw.consume('u').remaining, 2);
  assert.equal(sw.consume('u').remaining, 1);
  assert.equal(sw.consume('u').remaining, 0);
  assert.equal(sw.consume('u').allowed, false);
});

test('M2: previous window is weighted by its remaining overlap', () => {
  const c = clock(10_000);
  const sw = new SlidingWindowCounter({ limit: 10, windowMs: 1000, now: c.now });
  for (let i = 0; i < 10; i++) sw.consume('u');
  c.set(11_250); // 75% of the previous window still overlaps → estimate 7.5
  const d = sw.check('u', 2);
  assert.equal(d.allowed, true);
  assert.equal(d.remaining, 0); // floor(10 - 7.5 - 2)
  assert.equal(sw.check('u', 3).allowed, false);
  c.set(11_500); // estimate 5
  assert.equal(sw.check('u', 5).allowed, true);
  c.set(12_000); // two windows later: fully reset
  assert.equal(sw.check('u', 10).allowed, true);
});

test('M2: sliding window smooths the fixed-window boundary burst', () => {
  const c = clock(10_900);
  const sw = new SlidingWindowCounter({ limit: 10, windowMs: 1000, now: c.now });
  for (let i = 0; i < 10; i++) assert.equal(sw.consume('u').allowed, true);
  c.set(11_000); // a fixed-window limiter would allow 10 more right now
  let allowed = 0;
  for (let i = 0; i < 10; i++) if (sw.consume('u').allowed) allowed++;
  assert.equal(allowed, 0);
});

test('M2: retryAfterMs is exact within the window and across the next window', () => {
  const c = clock(10_000);
  const sw = new SlidingWindowCounter({ limit: 10, windowMs: 1000, now: c.now });
  for (let i = 0; i < 10; i++) sw.consume('u');
  // case A: current window full → must wait into the next window for decay
  const a = sw.consume('u', 4);
  assert.equal(a.allowed, false);
  assert.equal(a.retryAfterMs, 1400); // next window starts in 1000ms, then 10*(1-x)+4<=10 → x=400
  c.advance(a.retryAfterMs - 1);
  assert.equal(sw.check('u', 4).allowed, false);
  c.advance(1);
  assert.equal(sw.consume('u', 4).allowed, true);
  // case B: now at 11_400 with prev=10, curr=4 → need prev weight <= 2 → elapsed >= 800
  const b = sw.consume('u', 4);
  assert.equal(b.allowed, false);
  assert.equal(b.retryAfterMs, 400);
  c.advance(399);
  assert.equal(sw.check('u', 4).allowed, false);
  c.advance(1);
  assert.equal(sw.consume('u', 4).allowed, true);
});

test('M2: cost above the limit is never allowed', () => {
  const sw = new SlidingWindowCounter({ limit: 5, windowMs: 1000, now: () => 0 });
  const d = sw.consume('u', 6);
  assert.equal(d.allowed, false);
  assert.equal(d.retryAfterMs, Infinity);
  assert.throws(() => new SlidingWindowCounter({ limit: 5, windowMs: 0 }), RangeError);
});

// ---------- M3: multi-rule limiter ----------

test('M3: limiter allows only when every rule allows and reports min remaining', () => {
  const c = clock(0);
  const burst = new TokenBucket({ name: 'burst', capacity: 5, refillPerSecond: 5, now: c.now });
  const hourly = new SlidingWindowCounter({ name: 'hourly', limit: 3, windowMs: 3_600_000, now: c.now });
  const rl = new RateLimiter([burst, hourly]);
  const d = rl.consume('ip');
  assert.equal(d.allowed, true);
  assert.equal(d.remaining, 2);
  assert.deepEqual(d.deniedBy, []);
});

test('M3: a denied request is charged against NO rule (no partial charge)', () => {
  const c = clock(0);
  const burst = new TokenBucket({ name: 'burst', capacity: 10, refillPerSecond: 1, now: c.now });
  const strict = new SlidingWindowCounter({ name: 'strict', limit: 2, windowMs: 60_000, now: c.now });
  const rl = new RateLimiter([burst, strict]);
  rl.consume('k');
  rl.consume('k');
  for (let i = 0; i < 5; i++) {
    const d = rl.consume('k');
    assert.equal(d.allowed, false);
    assert.deepEqual(d.deniedBy, ['strict']);
  }
  // burst must have been charged only twice
  assert.equal(burst.check('k').remaining, 7);
});

test('M3: denied retryAfterMs is the max over the denying rules; check() charges nothing', () => {
  const c = clock(0);
  const a = new TokenBucket({ name: 'a', capacity: 1, refillPerSecond: 2, now: c.now }); // 500ms per token
  const b = new TokenBucket({ name: 'b', capacity: 1, refillPerSecond: 5, now: c.now }); // 200ms per token
  const rl = new RateLimiter([a, b]);
  rl.consume('k');
  const peek = rl.check('k');
  assert.equal(peek.allowed, false);
  assert.deepEqual(peek.deniedBy, ['a', 'b']);
  assert.equal(peek.retryAfterMs, 500);
  c.advance(300);
  const d = rl.consume('k');
  assert.deepEqual(d.deniedBy, ['a']);
  assert.equal(d.retryAfterMs, 200);
  c.advance(200);
  assert.equal(rl.consume('k').allowed, true);
  assert.throws(() => new RateLimiter([]), RangeError);
});

test('M3: reset clears a key in every rule', () => {
  const c = clock(0);
  const a = new TokenBucket({ capacity: 1, refillPerSecond: 0.001, now: c.now });
  const b = new SlidingWindowCounter({ limit: 1, windowMs: 1e9, now: c.now });
  const rl = new RateLimiter([a, b]);
  rl.consume('k');
  assert.equal(rl.consume('k').allowed, false);
  rl.reset('k');
  assert.equal(rl.consume('k').allowed, true);
});

// ---------- M4: memory bound ----------

test('M4: maxKeys evicts the least-recently-used key', () => {
  const c = clock(0);
  const tb = new TokenBucket({ capacity: 1, refillPerSecond: 0.001, now: c.now, maxKeys: 2 });
  tb.consume('a');
  tb.consume('b');
  tb.consume('a'); // touch a (denied, but still a use)
  tb.consume('c'); // evicts b
  assert.equal(tb.size, 2);
  assert.equal(tb.check('b').allowed, true, 'b was evicted → fresh');
  assert.equal(tb.check('a').allowed, false, 'a survived');
});

test('M4: sweep drops idle token buckets (refilled to full) and keeps busy ones', () => {
  const c = clock(0);
  const tb = new TokenBucket({ capacity: 10, refillPerSecond: 10, now: c.now });
  tb.consume('idle', 5);
  c.advance(400);
  tb.consume('busy', 10);
  assert.equal(tb.sweep(), 0, 'idle has 9 tokens, not yet full');
  c.advance(100);
  assert.equal(tb.sweep(), 1);
  assert.equal(tb.size, 1);
  assert.equal(tb.check('busy').remaining, 0);
});

test('M4: sweep drops sliding-window keys once both windows are empty', () => {
  const c = clock(0);
  const sw = new SlidingWindowCounter({ limit: 5, windowMs: 1000, now: c.now });
  sw.consume('a');
  c.set(1500);
  sw.consume('b');
  assert.equal(sw.sweep(), 0, 'a still weighs in the previous window');
  c.set(2000);
  assert.equal(sw.sweep(), 1);
  assert.equal(sw.size, 1);
  c.set(3000);
  assert.equal(sw.sweep(), 1);
  assert.equal(sw.size, 0);
});

test('M4: 50k distinct keys with maxKeys stay bounded', () => {
  const tb = new SlidingWindowCounter({ limit: 1, windowMs: 1000, now: () => 0, maxKeys: 1000 });
  for (let i = 0; i < 50_000; i++) tb.consume('k' + i);
  assert.equal(tb.size, 1000);
});

// ---------- M5: Retry-After ----------

test('M5: retryAfterHeader rounds up to whole seconds and handles never/zero', () => {
  assert.equal(retryAfterHeader(0), '0');
  assert.equal(retryAfterHeader(1), '1');
  assert.equal(retryAfterHeader(1000), '1');
  assert.equal(retryAfterHeader(1001), '2');
  assert.equal(retryAfterHeader(Infinity), null);
});
