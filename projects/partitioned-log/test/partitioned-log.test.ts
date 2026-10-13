import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { Broker, fnv1a, partitionFor, OffsetOutOfRangeError, NotAssignedError } = mod;

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const values = (rs: { value: string }[]) => rs.map((r) => r.value);

test('M1: fnv1a matches the reference vectors and partitionFor is stable and in range', () => {
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('a'), 0xe40c292c);
  assert.equal(fnv1a('foobar'), 0xbf9cf968);
  for (const k of ['user-1', 'user-2', 'ऐ', '🙂']) {
    const p = partitionFor(k, 7);
    assert.ok(Number.isInteger(p) && p >= 0 && p < 7);
    assert.equal(partitionFor(k, 7), p);
  }
});

test('M1: offsets start at 0 and increase independently per partition', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('orders', 3);
  assert.equal(b.partitionCount('orders'), 3);
  assert.equal(b.produceTo('orders', 0, null, 'a'), 0);
  assert.equal(b.produceTo('orders', 0, null, 'b'), 1);
  assert.equal(b.produceTo('orders', 2, null, 'c'), 0);
  assert.equal(b.endOffset('orders', 0), 2);
  assert.equal(b.endOffset('orders', 1), 0);
  assert.throws(() => b.createTopic('orders', 3));
  assert.throws(() => b.createTopic('bad', 0));
  assert.throws(() => b.produceTo('orders', 3, null, 'x'));
  assert.throws(() => b.produce('nope', 'k', 'x'));
});

test('M1: read returns a bounded slice from an offset, with record metadata and injected timestamps', () => {
  const c = clock(5_000);
  const b = new Broker({ now: c.now });
  b.createTopic('t', 1);
  for (let i = 0; i < 5; i++) { b.produceTo('t', 0, `k${i}`, `v${i}`); c.advance(10); }
  const rs = b.read('t', 0, 1, 2);
  assert.deepEqual(rs, [
    { topic: 't', partition: 0, offset: 1, key: 'k1', value: 'v1', timestamp: 5_010 },
    { topic: 't', partition: 0, offset: 2, key: 'k2', value: 'v2', timestamp: 5_020 },
  ]);
  assert.deepEqual(b.read('t', 0, 5, 10), [], 'reading at the end returns nothing');
  rs[0].value = 'mutated';
  assert.equal(b.read('t', 0, 1, 1)[0].value, 'v1', 'returned records are copies');
});

test('M2: records with the same key land on the same partition in produce order; null keys round-robin', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 4);
  const placed = ['u1', 'u2', 'u1', 'u3', 'u1'].map((k, i) => ({ k, ...b.produce('t', k, `${k}#${i}`) }));
  for (const p of placed) assert.equal(p.partition, partitionFor(p.k, 4));
  const p1 = partitionFor('u1', 4);
  const u1 = b.read('t', p1, 0, 100).filter((r) => r.key === 'u1');
  assert.deepEqual(values(u1), ['u1#0', 'u1#2', 'u1#4']);

  const b2 = new Broker({ now: clock().now });
  b2.createTopic('t', 3);
  assert.deepEqual([0, 1, 2, 3, 4].map(() => b2.produce('t', null, 'x').partition), [0, 1, 2, 0, 1]);
});

test('M2: key hashing spreads 8000 keys roughly evenly over 8 partitions', () => {
  const counts = new Array(8).fill(0);
  for (let i = 0; i < 8000; i++) counts[partitionFor(`customer-${i}`, 8)]++;
  for (const c of counts) assert.ok(c > 800 && c < 1200, `partition count ${c} is skewed: ${counts}`);
});

test('M3: a single member is assigned every partition and poll advances its position', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 2);
  b.produceTo('t', 0, null, 'a0'); b.produceTo('t', 1, null, 'b0'); b.produceTo('t', 0, null, 'a1');
  b.joinGroup('g', 'c1', ['t']);
  assert.deepEqual(b.assignment('g', 'c1'), [{ topic: 't', partition: 0 }, { topic: 't', partition: 1 }]);
  assert.deepEqual(values(b.poll('g', 'c1', 10)), ['a0', 'a1', 'b0']);
  assert.deepEqual(b.poll('g', 'c1', 10), [], 'nothing new');
  b.produceTo('t', 1, null, 'b1');
  assert.deepEqual(values(b.poll('g', 'c1', 10)), ['b1']);
});

test('M3: poll returns at most maxRecords across partitions', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 2);
  for (let i = 0; i < 3; i++) { b.produceTo('t', 0, null, `a${i}`); b.produceTo('t', 1, null, `b${i}`); }
  b.joinGroup('g', 'c', ['t']);
  assert.deepEqual(values(b.poll('g', 'c', 4)), ['a0', 'a1', 'a2', 'b0']);
  assert.deepEqual(values(b.poll('g', 'c', 4)), ['b1', 'b2']);
});

test('M3: partitions are split round-robin over sorted member ids and generation bumps on every rebalance', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 5);
  b.joinGroup('g', 'zed', ['t']);
  assert.equal(b.generation('g'), 1);
  b.joinGroup('g', 'amy', ['t']);
  assert.equal(b.generation('g'), 2);
  assert.deepEqual(b.members('g'), ['amy', 'zed']);
  assert.deepEqual(b.assignment('g', 'amy').map((tp) => tp.partition), [0, 2, 4]);
  assert.deepEqual(b.assignment('g', 'zed').map((tp) => tp.partition), [1, 3]);
  b.joinGroup('g', 'bob', ['t']);
  const all = ['amy', 'bob', 'zed'].flatMap((m) => b.assignment('g', m).map((tp) => tp.partition)).sort();
  assert.deepEqual(all, [0, 1, 2, 3, 4], 'every partition has exactly one owner');
  assert.deepEqual(b.assignment('g', 'bob').map((tp) => tp.partition), [1, 4]);
});

test('M3: more members than partitions leaves the extra members idle', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 2);
  for (const m of ['a', 'b', 'c']) b.joinGroup('g', m, ['t']);
  assert.equal(b.assignment('g', 'a').length, 1);
  assert.equal(b.assignment('g', 'b').length, 1);
  assert.deepEqual(b.assignment('g', 'c'), []);
  assert.deepEqual(b.poll('g', 'c', 10), []);
});

test('M4: commit stores the next offset to read; only the owner may commit and commits are all-or-nothing', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 2);
  for (let i = 0; i < 4; i++) b.produceTo('t', 0, null, `v${i}`);
  b.joinGroup('g', 'a', ['t']);
  b.joinGroup('g', 'b', ['t']); // a owns p0, b owns p1
  assert.equal(b.committed('g', 't', 0), undefined);
  b.commit('g', 'a', [{ topic: 't', partition: 0, offset: 2 }]);
  assert.equal(b.committed('g', 't', 0), 2);
  assert.throws(() => b.commit('g', 'b', [{ topic: 't', partition: 0, offset: 3 }]), NotAssignedError);
  assert.throws(() => b.commit('g', 'a', [{ topic: 't', partition: 0, offset: 99 }]), OffsetOutOfRangeError);
  assert.throws(() => b.commit('g', 'a', [{ topic: 't', partition: 0, offset: 3 }, { topic: 't', partition: 1, offset: 0 }]), NotAssignedError);
  assert.equal(b.committed('g', 't', 0), 2, 'the valid half of a rejected commit is not applied');
});

test('M4: lag is the sum over partitions of end offset minus committed offset', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 2);
  for (let i = 0; i < 5; i++) b.produceTo('t', 0, null, 'x');
  for (let i = 0; i < 3; i++) b.produceTo('t', 1, null, 'y');
  b.joinGroup('g', 'c', ['t']);
  assert.equal(b.lag('g', 't'), 8);
  b.poll('g', 'c', 100); // polling alone does not reduce lag; committing does
  assert.equal(b.lag('g', 't'), 8);
  b.commit('g', 'c', [{ topic: 't', partition: 0, offset: 5 }, { topic: 't', partition: 1, offset: 1 }]);
  assert.equal(b.lag('g', 't'), 2);
});

test('M5: uncommitted records are redelivered to the new owner when a consumer dies', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 1);
  for (let i = 0; i < 5; i++) b.produceTo('t', 0, null, `m${i}`);
  b.joinGroup('g', 'a', ['t']);
  b.joinGroup('g', 'b', ['t']); // 1 partition: a (sorted first) owns it
  assert.deepEqual(values(b.poll('g', 'a', 10)), ['m0', 'm1', 'm2', 'm3', 'm4']);
  b.commit('g', 'a', [{ topic: 't', partition: 0, offset: 3 }]); // processed m0..m2, then crashed
  b.leaveGroup('g', 'a');
  assert.deepEqual(b.assignment('g', 'b'), [{ topic: 't', partition: 0 }]);
  assert.deepEqual(values(b.poll('g', 'b', 10)), ['m3', 'm4'], 'at-least-once: m3, m4 were never committed');
});

test('M5: a rebalance resets positions to the committed offset, so the same member re-reads uncommitted records', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 1);
  for (let i = 0; i < 4; i++) b.produceTo('t', 0, null, `m${i}`);
  b.joinGroup('g', 'a', ['t']);
  b.poll('g', 'a', 10);
  b.commit('g', 'a', [{ topic: 't', partition: 0, offset: 1 }]);
  b.joinGroup('g', 'z', ['t']); // rebalance; a keeps partition 0
  assert.deepEqual(values(b.poll('g', 'a', 10)), ['m1', 'm2', 'm3']);
});

test('M5: a zombie that lost its partition in a rebalance cannot commit it', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 2);
  for (let i = 0; i < 3; i++) b.produceTo('t', 1, null, `m${i}`);
  b.joinGroup('g', 'b', ['t']);
  b.poll('g', 'b', 10); // b owns p0,p1 and reads p1
  b.joinGroup('g', 'a', ['t']); // now a: p0, b: p1
  b.joinGroup('g', 'c', ['t']); // a: p0, b: p1, c: — (sorted a,b,c)
  b.leaveGroup('g', 'a'); // b: p0, c: p1 → b lost p1
  assert.deepEqual(b.assignment('g', 'c'), [{ topic: 't', partition: 1 }]);
  assert.throws(() => b.commit('g', 'b', [{ topic: 't', partition: 1, offset: 3 }]), NotAssignedError);
  assert.deepEqual(values(b.poll('g', 'c', 10)), ['m0', 'm1', 'm2']);
  assert.throws(() => b.poll('g', 'a', 10), NotAssignedError, 'a left the group');
});

test('M5: two groups consume the same topic independently', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 1);
  b.produceTo('t', 0, null, 'x'); b.produceTo('t', 0, null, 'y');
  b.joinGroup('billing', 'c', ['t']);
  b.joinGroup('search', 'c', ['t']);
  assert.deepEqual(values(b.poll('billing', 'c', 10)), ['x', 'y']);
  b.commit('billing', 'c', [{ topic: 't', partition: 0, offset: 2 }]);
  assert.equal(b.committed('search', 't', 0), undefined);
  assert.deepEqual(values(b.poll('search', 'c', 1)), ['x']);
});

test('M6: retention by count deletes the oldest records without renumbering offsets', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 1, { retentionMaxRecords: 3 });
  for (let i = 0; i < 5; i++) assert.equal(b.produceTo('t', 0, null, `v${i}`), i);
  assert.equal(b.logStartOffset('t', 0), 2);
  assert.equal(b.endOffset('t', 0), 5);
  assert.throws(() => b.read('t', 0, 1, 10), OffsetOutOfRangeError);
  assert.deepEqual(b.read('t', 0, 2, 10).map((r) => [r.offset, r.value]), [[2, 'v2'], [3, 'v3'], [4, 'v4']]);
});

test('M6: a group whose committed offset fell behind retention restarts at the log start', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('t', 1, { retentionMaxRecords: 2 });
  b.produceTo('t', 0, null, 'v0');
  b.joinGroup('g', 'c', ['t']);
  b.poll('g', 'c', 10);
  b.commit('g', 'c', [{ topic: 't', partition: 0, offset: 1 }]);
  for (let i = 1; i < 6; i++) b.produceTo('t', 0, null, `v${i}`); // log now holds v4, v5
  b.leaveGroup('g', 'c');
  b.joinGroup('g', 'c', ['t']);
  assert.deepEqual(values(b.poll('g', 'c', 10)), ['v4', 'v5']);
  assert.equal(b.lag('g', 't'), 2, 'lag counts only retained records');
});

test('M6: members only receive partitions of topics they subscribed to', () => {
  const b = new Broker({ now: clock().now });
  b.createTopic('orders', 2);
  b.createTopic('payments', 2);
  b.joinGroup('g', 'a', ['orders', 'payments']);
  b.joinGroup('g', 'b', ['payments']);
  assert.deepEqual(b.assignment('g', 'a'), [{ topic: 'orders', partition: 0 }, { topic: 'orders', partition: 1 }, { topic: 'payments', partition: 0 }]);
  assert.deepEqual(b.assignment('g', 'b'), [{ topic: 'payments', partition: 1 }]);
  assert.throws(() => b.joinGroup('g', 'c', ['missing-topic']));
});
