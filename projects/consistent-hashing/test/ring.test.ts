import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { HashRing, fnv1a32, fmix32, hash32 } = mod;

/** Independent, seeded, high-quality hash so balance tests don't depend on your hash32. */
const seeded = (seed: string) => (s: string) => createHash('md5').update(seed + ':' + s).digest().readUInt32BE(0);
const keys = (n: number, prefix = 'user:') => Array.from({ length: n }, (_, i) => prefix + i);

function counts(ring: InstanceType<typeof HashRing>, ks: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of ks) {
    const n = ring.getNode(k)!;
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return m;
}

// ---------- M1: hashing ----------

test('M1: fnv1a32 matches the published test vectors', () => {
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1a32('a'), 0xe40c292c);
  assert.equal(fnv1a32('foobar'), 0xbf9cf968);
  assert.equal(fnv1a32('é'), fnv1a32('é'));
  assert.notEqual(fnv1a32('é'), fnv1a32('e'), 'must hash UTF-8 bytes');
});

test('M1: fmix32 and hash32 return deterministic unsigned 32-bit ints; the seed changes the output', () => {
  assert.equal(fmix32(0), 0);
  assert.equal(fmix32(1), 0x514e28b7);
  for (const s of ['', 'a', 'node-1#0', '日本']) {
    const h = hash32(s);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
    assert.equal(hash32(s), h);
    assert.notEqual(hash32(s, 1), h);
  }
  assert.equal(hash32('abc', 0), fmix32(fnv1a32('abc')));
});

test('M1: hash32 spreads near-identical labels evenly across 16 buckets', () => {
  const buckets = new Array(16).fill(0);
  for (let i = 0; i < 16_000; i++) buckets[hash32('node-1#' + i) >>> 28]++;
  for (const b of buckets) assert.ok(b > 800 && b < 1200, `bucket count ${b}`);
});

// ---------- M2: ring basics ----------

function tableRing() {
  const table: Record<string, number> = { 'A#0': 100, 'B#0': 200, 'C#0': 300 };
  const ring = new HashRing({ vnodes: 1, hash: (s) => table[s] ?? Number(s) });
  ring.addNode('B');
  ring.addNode('C');
  ring.addNode('A');
  return ring;
}

test('M2: getNode picks the first point clockwise (>=) and wraps around', () => {
  const ring = tableRing();
  assert.equal(ring.getNode('50'), 'A');
  assert.equal(ring.getNode('100'), 'A');
  assert.equal(ring.getNode('101'), 'B');
  assert.equal(ring.getNode('250'), 'C');
  assert.equal(ring.getNode('301'), 'A');
  assert.deepEqual(ring.nodes, ['A', 'B', 'C']);
  assert.equal(ring.pointCount, 3);
});

test('M2: empty ring returns undefined / []; removeNode reroutes to the successor', () => {
  const empty = new HashRing();
  assert.equal(empty.getNode('x'), undefined);
  assert.deepEqual(empty.getNodes('x', 3), []);
  const ring = tableRing();
  assert.equal(ring.removeNode('B'), true);
  assert.equal(ring.removeNode('B'), false);
  assert.equal(ring.getNode('150'), 'C');
  assert.equal(ring.pointCount, 2);
  ring.removeNode('A');
  ring.removeNode('C');
  assert.equal(ring.getNode('150'), undefined);
});

test('M2: duplicate nodes, bad weights and bad vnodes are rejected', () => {
  const ring = new HashRing();
  ring.addNode('a');
  assert.throws(() => ring.addNode('a'));
  assert.throws(() => ring.addNode('b', 0), RangeError);
  assert.throws(() => ring.addNode('c', -2), RangeError);
  assert.throws(() => new HashRing({ vnodes: 0 }), RangeError);
});

test('M2: virtual nodes — each node contributes `vnodes` points labelled id#i', () => {
  const seen: string[] = [];
  const ring = new HashRing({ vnodes: 4, hash: (s) => (seen.push(s), hash32(s)) });
  ring.addNode('n1');
  assert.equal(ring.pointCount, 4);
  assert.deepEqual(seen.sort(), ['n1#0', 'n1#1', 'n1#2', 'n1#3']);
});

test('M2: lookups are deterministic and independent of insertion order', () => {
  const h = seeded('order');
  const r1 = new HashRing({ vnodes: 50, hash: h });
  const r2 = new HashRing({ vnodes: 50, hash: h });
  for (const n of ['a', 'b', 'c', 'd']) r1.addNode(n);
  for (const n of ['d', 'b', 'a', 'c']) r2.addNode(n);
  for (const k of keys(2000)) assert.equal(r1.getNode(k), r2.getNode(k));
});

// ---------- M3: balance & minimal movement ----------

test('M3: 10 nodes × 200 vnodes keep every node within ±25% of the mean load', () => {
  const ring = new HashRing({ vnodes: 200, hash: seeded('balance') });
  for (let i = 0; i < 10; i++) ring.addNode('node-' + i);
  const c = counts(ring, keys(50_000));
  assert.equal(c.size, 10);
  for (const [n, v] of c) assert.ok(v > 3750 && v < 6250, `${n} has ${v} keys`);
});

test('M3: the default hash32 also balances within ±25%', () => {
  const ring = new HashRing({ vnodes: 200 });
  for (let i = 0; i < 8; i++) ring.addNode('10.0.0.' + i);
  const c = counts(ring, keys(40_000));
  for (const [n, v] of c) assert.ok(v > 3750 && v < 6250, `${n} has ${v} keys`);
});

test('M3: more virtual nodes → lower load imbalance', () => {
  const spread = (v: number) => {
    const ring = new HashRing({ vnodes: v, hash: seeded('spread') });
    for (let i = 0; i < 10; i++) ring.addNode('n' + i);
    const vals = [...counts(ring, keys(30_000)).values()];
    return Math.max(...vals) / Math.min(...vals);
  };
  assert.ok(spread(1) > spread(200), `1 vnode spread ${spread(1)} vs 200 vnodes ${spread(200)}`);
});

test('M3: adding an 11th node moves ≈1/11 of keys, all of them TO the new node', () => {
  const ring = new HashRing({ vnodes: 150, hash: seeded('add') });
  for (let i = 0; i < 10; i++) ring.addNode('n' + i);
  const ks = keys(30_000);
  const before = ks.map((k) => ring.getNode(k));
  ring.addNode('n10');
  let moved = 0;
  ks.forEach((k, i) => {
    const after = ring.getNode(k);
    if (after !== before[i]) {
      moved++;
      assert.equal(after, 'n10', 'keys may only move to the new node');
    }
  });
  const frac = moved / ks.length;
  assert.ok(frac > 0.06 && frac < 0.125, `moved ${(frac * 100).toFixed(1)}%`);
});

test('M3: removing a node moves only that node’s keys', () => {
  const ring = new HashRing({ vnodes: 100, hash: seeded('remove') });
  for (let i = 0; i < 6; i++) ring.addNode('n' + i);
  const ks = keys(10_000);
  const before = ks.map((k) => ring.getNode(k));
  ring.removeNode('n3');
  ks.forEach((k, i) => {
    if (before[i] !== 'n3') assert.equal(ring.getNode(k), before[i]);
    else assert.notEqual(ring.getNode(k), 'n3');
  });
});

// ---------- M4: replicas ----------

test('M4: getNodes returns N distinct physical nodes, first = getNode', () => {
  const ring = new HashRing({ vnodes: 50, hash: seeded('rep') });
  for (let i = 0; i < 5; i++) ring.addNode('n' + i);
  for (const k of keys(500)) {
    const pref = ring.getNodes(k, 3);
    assert.equal(pref.length, 3);
    assert.equal(new Set(pref).size, 3);
    assert.equal(pref[0], ring.getNode(k));
  }
  assert.equal(ring.getNodes('x', 10).length, 5, 'capped at node count');
  assert.deepEqual(ring.getNodes('x', 0), []);
});

test('M4: getNodes walks clockwise skipping repeated physical nodes', () => {
  const table: Record<string, number> = { 'A#0': 10, 'A#1': 20, 'B#0': 30, 'A#2': 40, 'C#0': 50 };
  const ring = new HashRing({ vnodes: 1, hash: (s) => table[s] ?? Number(s) });
  ring.addNode('A', 3);
  ring.addNode('B');
  ring.addNode('C');
  assert.deepEqual(ring.getNodes('5', 3), ['A', 'B', 'C']);
  assert.deepEqual(ring.getNodes('45', 2), ['C', 'A']);
  assert.deepEqual(ring.getNodes('35', 3), ['A', 'C', 'B']);
});

// ---------- M5: weights & performance ----------

test('M5: a weight-2 node gets ≈2× the keys of a weight-1 node', () => {
  const ring = new HashRing({ vnodes: 200, hash: seeded('weights') });
  ring.addNode('small', 1);
  ring.addNode('big', 2);
  ring.addNode('mid', 1);
  assert.equal(ring.pointCount, 800);
  const c = counts(ring, keys(40_000));
  const ratio = c.get('big')! / ((c.get('small')! + c.get('mid')!) / 2);
  assert.ok(ratio > 1.6 && ratio < 2.4, `ratio ${ratio.toFixed(2)}`);
});

test('M5: 200k lookups on a 20,000-point ring finish quickly (binary search)', () => {
  const ring = new HashRing({ vnodes: 200 });
  for (let i = 0; i < 100; i++) ring.addNode('n' + i);
  const start = process.hrtime.bigint();
  for (let i = 0; i < 200_000; i++) ring.getNode('k' + i);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 2_500, `took ${ms.toFixed(0)}ms`);
});
