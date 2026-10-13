import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { murmur3_32, sketchDimensions, CountMinSketch, MinHeap, HeavyHitters, TrendingTopK } = mod;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Zipf(s) stream over `n` items ("item-0" is the most popular). */
function zipfStream(n: number, s: number, length: number, seed: number): string[] {
  const cdf: number[] = [];
  let total = 0;
  for (let i = 1; i <= n; i++) { total += 1 / i ** s; cdf.push(total); }
  const r = rng(seed);
  const out: string[] = [];
  for (let j = 0; j < length; j++) {
    const u = r() * total;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < u) lo = m + 1; else hi = m; }
    out.push(`item-${lo}`);
  }
  return out;
}

function exactCounts(stream: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of stream) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

const ZIPF = zipfStream(5000, 1.1, 100_000, 7);
const TRUTH = exactCounts(ZIPF);

test('M1: murmur3_32 matches the reference test vectors', () => {
  assert.equal(murmur3_32('', 0), 0);
  assert.equal(murmur3_32('', 1), 0x514e28b7);
  assert.equal(murmur3_32('hello', 0), 0x248bfa47);
  assert.equal(murmur3_32('aaaa', 0x9747b28c), 0x5a97808a);
  assert.equal(murmur3_32('The quick brown fox jumps over the lazy dog', 0), 0x2e4ff723);
  assert.notEqual(murmur3_32('x', 1), murmur3_32('x', 2), 'the seed changes the hash');
});

test('M1: sketchDimensions computes width = ⌈e/ε⌉ and depth = ⌈ln 1/δ⌉', () => {
  assert.deepEqual(sketchDimensions(0.01, 0.01), { width: 272, depth: 5 });
  assert.deepEqual(sketchDimensions(0.001, 0.0001), { width: 2719, depth: 10 });
  assert.deepEqual(sketchDimensions(0.1, 0.5), { width: 28, depth: 1 });
  assert.throws(() => sketchDimensions(0, 0.1));
  assert.throws(() => sketchDimensions(0.1, 1));
  const s = CountMinSketch.fromError(0.01, 0.01, 3);
  assert.deepEqual([s.width, s.depth, s.seed], [272, 5, 3]);
});

test('M2: a wide sketch counts a few items exactly; total tracks N; bad counts are rejected', () => {
  const s = new CountMinSketch({ width: 10_000, depth: 4, seed: 1 });
  s.add('a'); s.add('a'); s.add('b', 5);
  assert.equal(s.estimate('a'), 2);
  assert.equal(s.estimate('b'), 5);
  assert.equal(s.estimate('never-seen'), 0);
  assert.equal(s.total, 7);
  assert.throws(() => s.add('a', 0));
  assert.throws(() => s.add('a', 1.5));
  assert.throws(() => new CountMinSketch({ width: 0, depth: 1 }));
});

test('M2: estimates never underestimate, even in a tiny overloaded sketch', () => {
  const s = new CountMinSketch({ width: 16, depth: 3, seed: 9 });
  for (const x of ZIPF.slice(0, 20_000)) s.add(x);
  const truth = exactCounts(ZIPF.slice(0, 20_000));
  for (const [item, c] of truth) assert.ok(s.estimate(item) >= c, `${item}: ${s.estimate(item)} < ${c}`);
});

test('M2: on a Zipf stream, at most a δ fraction of items exceed the ε·N error bound', () => {
  const epsilon = 0.002, delta = 0.05;
  const s = CountMinSketch.fromError(epsilon, delta, 42);
  for (const x of ZIPF) s.add(x);
  let over = 0;
  for (const [item, c] of TRUTH) if (s.estimate(item) - c > epsilon * s.total) over++;
  const fraction = over / TRUTH.size;
  assert.ok(fraction <= delta, `${(fraction * 100).toFixed(2)}% of items exceeded εN`);
  assert.ok(s.width * s.depth < TRUTH.size * 2, 'and it uses less memory than one counter per distinct item would need');
});

test('M2: the same seed gives identical estimates; more rows reduce the error', () => {
  const a = new CountMinSketch({ width: 64, depth: 1, seed: 5 });
  const b = new CountMinSketch({ width: 64, depth: 1, seed: 5 });
  const deep = new CountMinSketch({ width: 64, depth: 6, seed: 5 });
  for (const x of ZIPF.slice(0, 30_000)) { a.add(x); b.add(x); deep.add(x); }
  const truth = exactCounts(ZIPF.slice(0, 30_000));
  let errShallow = 0, errDeep = 0;
  for (const [item, c] of truth) {
    assert.equal(a.estimate(item), b.estimate(item));
    errShallow += a.estimate(item) - c;
    errDeep += deep.estimate(item) - c;
  }
  assert.ok(errDeep < errShallow / 2, `depth 6 total error ${errDeep} vs depth 1 ${errShallow}`);
});

test('M3: merging sketches equals sketching the concatenated stream (counts are additive)', () => {
  const left = CountMinSketch.fromError(0.01, 0.01, 7);
  const right = CountMinSketch.fromError(0.01, 0.01, 7);
  const whole = CountMinSketch.fromError(0.01, 0.01, 7);
  ZIPF.slice(0, 10_000).forEach((x) => { left.add(x); whole.add(x); });
  ZIPF.slice(10_000, 25_000).forEach((x) => { right.add(x); whole.add(x); });
  const rightBefore = right.estimate('item-0');
  left.merge(right);
  assert.equal(left.total, whole.total);
  for (const item of ['item-0', 'item-1', 'item-50', 'item-4000', 'nope']) assert.equal(left.estimate(item), whole.estimate(item));
  assert.equal(right.estimate('item-0'), rightBefore, 'merge does not modify its argument');
});

test('M3: merge rejects incompatible sketches; clone is independent', () => {
  const a = new CountMinSketch({ width: 100, depth: 3, seed: 1 });
  assert.throws(() => a.merge(new CountMinSketch({ width: 101, depth: 3, seed: 1 })));
  assert.throws(() => a.merge(new CountMinSketch({ width: 100, depth: 4, seed: 1 })));
  assert.throws(() => a.merge(new CountMinSketch({ width: 100, depth: 3, seed: 2 })), 'different seeds hash to different cells');
  a.add('x', 3);
  const c = a.clone();
  c.add('x', 10);
  assert.equal(a.estimate('x'), 3);
  assert.equal(c.estimate('x'), 13);
  assert.equal(c.total, 13);
});

test('M4: MinHeap pops in comparator order', () => {
  const h = new MinHeap<number>((a, b) => a - b);
  assert.equal(h.pop(), undefined);
  const r = rng(3);
  const xs = Array.from({ length: 200 }, () => Math.floor(r() * 1000));
  xs.forEach((x) => h.push(x));
  assert.equal(h.size, 200);
  assert.equal(h.peek(), Math.min(...xs));
  const out: number[] = [];
  while (h.size) out.push(h.pop()!);
  assert.deepEqual(out, [...xs].sort((a, b) => a - b));
  const maxHeap = new MinHeap<string>((a, b) => b.localeCompare(a));
  ['b', 'c', 'a'].forEach((x) => maxHeap.push(x));
  assert.equal(maxHeap.pop(), 'c');
});

test('M4: HeavyHitters keeps at most K candidates, ranked by count desc then item asc', () => {
  const hh = new HeavyHitters({ k: 3, epsilon: 0.001, delta: 0.001, seed: 1 });
  const stream = 'a b c d a b c a b a e e e e e f'.split(' ');
  for (const x of stream) hh.add(x);
  assert.deepEqual(hh.top(), [
    { item: 'e', count: 5 },
    { item: 'a', count: 4 },
    { item: 'b', count: 3 },
  ]);
  hh.add('c');
  assert.deepEqual(hh.top()[2], { item: 'b', count: 3 }, 'tie at 3: b ranks above c');
  hh.add('c', 2);
  assert.deepEqual(hh.top().map((r) => r.item), ['c', 'e', 'a'], 'c (5) displaced b and ties with e');
  assert.equal(hh.estimate('a'), 4);
});

test('M4: on a 100k-event Zipf stream, the top-10 matches the exact top-10', () => {
  const hh = new HeavyHitters({ k: 10, epsilon: 0.0005, delta: 0.01, seed: 11 });
  for (const x of ZIPF) hh.add(x);
  const exact = [...TRUTH].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);
  const got = hh.top();
  assert.deepEqual(got.map((r) => r.item), exact);
  for (const r of got) assert.ok(r.count >= TRUTH.get(r.item)!, 'sketch counts never underestimate');
});

test('M4: an item that becomes hot late still enters the top-K', () => {
  const hh = new HeavyHitters({ k: 2, seed: 2 });
  for (let i = 0; i < 50; i++) { hh.add('old-a'); hh.add('old-b'); }
  for (let i = 0; i < 60; i++) hh.add('newcomer');
  assert.deepEqual(hh.top().map((r) => r.item), ['newcomer', 'old-a']);
  assert.throws(() => new HeavyHitters({ k: 0 }));
});

test('M5: trending top-K only counts the last windowMs, in bucket granularity', () => {
  let t = 0;
  const tr = new TrendingTopK({ k: 2, windowMs: 5 * 60_000, bucketMs: 60_000, seed: 4, now: () => t });
  for (let i = 0; i < 100; i++) tr.add('yesterdays-news');
  t = 2 * 60_000;
  for (let i = 0; i < 30; i++) tr.add('rising');
  for (let i = 0; i < 10; i++) tr.add('steady');
  assert.deepEqual(tr.top().map((r) => r.item), ['yesterdays-news', 'rising']);
  t = 5 * 60_000; // bucket 0 (minute 0) is now outside the 5-minute window
  assert.deepEqual(tr.top(), [{ item: 'rising', count: 30 }, { item: 'steady', count: 10 }]);
  assert.equal(tr.windowCount('yesterdays-news'), 0);
  t = 7 * 60_000;
  assert.deepEqual(tr.top(), [], 'everything expired');
});

test('M5: trending merges buckets — a steady item spread over minutes beats a one-minute spike', () => {
  let t = 0;
  const tr = new TrendingTopK({ k: 1, windowMs: 10 * 60_000, bucketMs: 60_000, seed: 8, now: () => t });
  for (let m = 0; m < 10; m++) {
    t = m * 60_000 + 1_000;
    for (let i = 0; i < 20; i++) tr.add('steady');
    if (m === 4) for (let i = 0; i < 150; i++) tr.add('spike');
  }
  assert.deepEqual(tr.top(), [{ item: 'steady', count: 200 }]);
  assert.equal(tr.windowCount('spike'), 150);
});

test('M5: trending memory is bounded by the number of buckets in the window', () => {
  let t = 0;
  const tr = new TrendingTopK({ k: 5, windowMs: 3_000, bucketMs: 1_000, seed: 1, now: () => t });
  for (let s = 0; s < 50; s++) { t = s * 1_000; tr.add(`item-${s}`); }
  assert.equal(tr.bucketCount(), 3);
  assert.deepEqual(tr.top().map((r) => r.item).sort(), ['item-47', 'item-48', 'item-49']);
  assert.throws(() => new TrendingTopK({ k: 1, windowMs: 2_500, bucketMs: 1_000, now: () => 0 }));
});
