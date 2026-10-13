import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { DoublyLinkedList, LRUCache, LFUCache } = mod;

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

// ---------- M1: doubly linked list ----------

test('M1: linked list pushFront / popBack keep FIFO order from the back', () => {
  const l = new DoublyLinkedList<number>();
  assert.equal(l.length, 0);
  assert.equal(l.popBack(), null);
  l.pushFront(1);
  l.pushFront(2);
  l.pushFront(3);
  assert.deepEqual(l.toArray(), [3, 2, 1]);
  assert.equal(l.head!.value, 3);
  assert.equal(l.tail!.value, 1);
  assert.equal(l.popBack()!.value, 1);
  assert.equal(l.length, 2);
  assert.equal(l.tail!.value, 2);
  assert.equal(l.tail!.next, null);
});

test('M1: linked list remove(node) unlinks head, middle and tail in O(1)', () => {
  const l = new DoublyLinkedList<string>();
  const a = l.pushFront('a');
  const b = l.pushFront('b');
  const c = l.pushFront('c');
  l.remove(b);
  assert.deepEqual(l.toArray(), ['c', 'a']);
  assert.equal(c.next, a);
  assert.equal(a.prev, c);
  assert.equal(b.prev, null);
  assert.equal(b.next, null);
  l.remove(c);
  assert.equal(l.head, a);
  l.remove(a);
  assert.equal(l.head, null);
  assert.equal(l.tail, null);
  assert.equal(l.length, 0);
});

test('M1: linked list moveToFront works for tail, middle and head nodes', () => {
  const l = new DoublyLinkedList<number>();
  const n1 = l.pushFront(1);
  const n2 = l.pushFront(2);
  l.pushFront(3);
  l.moveToFront(n1); // tail
  assert.deepEqual(l.toArray(), [1, 3, 2]);
  assert.equal(l.tail, n2);
  l.moveToFront(n1); // already head
  assert.deepEqual(l.toArray(), [1, 3, 2]);
  l.moveToFront(l.head!.next!); // middle
  assert.deepEqual(l.toArray(), [3, 1, 2]);
  assert.equal(l.length, 3);
  // backwards walk must agree with forwards walk
  const back: number[] = [];
  for (let n: import('../solution/index.ts').ListNode<number> | null = l.tail; n; n = n.prev) back.push(n.value);
  assert.deepEqual(back, [2, 1, 3]);
});

// ---------- M2: LRU core ----------

test('M2: get returns undefined for a missing key; set/get round-trips', () => {
  const c = new LRUCache<string, number>({ capacity: 2 });
  assert.equal(c.get('x'), undefined);
  c.set('a', 1);
  assert.equal(c.get('a'), 1);
  assert.equal(c.size, 1);
  assert.equal(c.capacity, 2);
});

test('M2: constructor rejects a non-positive or fractional capacity', () => {
  assert.throws(() => new LRUCache({ capacity: 0 }), RangeError);
  assert.throws(() => new LRUCache({ capacity: -1 }), RangeError);
  assert.throws(() => new LRUCache({ capacity: 1.5 }), RangeError);
});

test('M2: evicts the least-recently-used key when over capacity', () => {
  const c = new LRUCache<string, number>({ capacity: 2 });
  c.set('a', 1).set('b', 2);
  c.get('a'); // a is now MRU
  c.set('c', 3); // evicts b
  assert.equal(c.has('b'), false);
  assert.deepEqual(c.keys(), ['c', 'a']);
  assert.equal(c.size, 2);
});

test('M2: overwriting a key updates value, refreshes recency and does not grow size', () => {
  const c = new LRUCache<string, number>({ capacity: 3 });
  c.set('a', 1).set('b', 2).set('c', 3);
  c.set('a', 10); // a becomes MRU, b is LRU
  assert.equal(c.size, 3);
  c.set('d', 4);
  assert.equal(c.has('b'), false);
  assert.equal(c.peek('a'), 10);
  assert.deepEqual(c.keys(), ['d', 'a', 'c']);
});

test('M2: peek and has do not change recency; get does', () => {
  const c = new LRUCache<string, number>({ capacity: 2 });
  c.set('a', 1).set('b', 2);
  assert.equal(c.peek('a'), 1);
  assert.equal(c.has('a'), true);
  c.set('c', 3); // a was still LRU → evicted
  assert.equal(c.has('a'), false);
  c.get('b');
  c.set('d', 4); // c is LRU now
  assert.deepEqual(c.keys(), ['d', 'b']);
});

test('M2: delete removes the key and frees capacity; clear empties the cache', () => {
  const c = new LRUCache<string, number>({ capacity: 2 });
  c.set('a', 1).set('b', 2);
  assert.equal(c.delete('a'), true);
  assert.equal(c.delete('a'), false);
  c.set('c', 3);
  assert.deepEqual(c.keys(), ['c', 'b']);
  c.clear();
  assert.equal(c.size, 0);
  assert.deepEqual(c.keys(), []);
  c.set('z', 26);
  assert.equal(c.get('z'), 26);
});

test('M2: capacity 1 and falsy values (0, null) are stored correctly', () => {
  const c = new LRUCache<string, unknown>({ capacity: 1 });
  c.set('zero', 0);
  assert.equal(c.get('zero'), 0);
  assert.equal(c.has('zero'), true);
  c.set('null', null);
  assert.equal(c.has('zero'), false);
  assert.equal(c.has('null'), true);
  assert.equal(c.get('null'), null);
});

test('M2: matches a brute-force model over 5,000 random operations', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cap = 7;
  const c = new LRUCache<number, number>({ capacity: cap });
  let model: Array<[number, number]> = []; // index 0 = MRU
  for (let i = 0; i < 5000; i++) {
    const k = Math.floor(rnd() * 15);
    const op = rnd();
    if (op < 0.45) {
      const idx = model.findIndex(([mk]) => mk === k);
      const expected = idx >= 0 ? model[idx][1] : undefined;
      if (idx >= 0) model = [model[idx], ...model.slice(0, idx), ...model.slice(idx + 1)];
      assert.equal(c.get(k), expected, `get(${k}) at op ${i}`);
    } else if (op < 0.9) {
      model = [[k, i] as [number, number], ...model.filter(([mk]) => mk !== k)].slice(0, cap);
      c.set(k, i);
    } else {
      const had = model.some(([mk]) => mk === k);
      model = model.filter(([mk]) => mk !== k);
      assert.equal(c.delete(k), had);
    }
    assert.equal(c.size, model.length);
  }
  assert.deepEqual(c.keys(), model.map(([k]) => k));
});

// ---------- M3: eviction callback ----------

test('M3: onEvict fires with reason "capacity" for LRU evictions only', () => {
  const evicted: Array<[string, number, string]> = [];
  const c = new LRUCache<string, number>({ capacity: 2, onEvict: (k, v, r) => evicted.push([k, v, r]) });
  c.set('a', 1).set('b', 2);
  c.set('a', 11); // overwrite: no callback
  c.delete('b'); // delete: no callback
  c.set('c', 3).set('d', 4); // evicts a
  assert.deepEqual(evicted, [['a', 11, 'capacity']]);
});

// ---------- M4: TTL with an injected clock ----------

test('M4: entries expire after the default ttl (boundary is inclusive)', () => {
  const t = clock();
  const c = new LRUCache<string, number>({ capacity: 5, ttlMs: 100, now: t.now });
  c.set('a', 1);
  t.advance(99);
  assert.equal(c.get('a'), 1);
  t.advance(1);
  assert.equal(c.get('a'), undefined);
  assert.equal(c.has('a'), false);
  assert.equal(c.size, 0);
});

test('M4: per-entry ttl overrides the default; reading does not extend ttl; re-set does', () => {
  const t = clock();
  const c = new LRUCache<string, number>({ capacity: 5, ttlMs: 1_000, now: t.now });
  c.set('short', 1, 10);
  c.set('long', 2);
  t.advance(10);
  assert.equal(c.peek('short'), undefined);
  assert.equal(c.peek('long'), 2);
  t.advance(900);
  c.get('long'); // read does not refresh
  c.set('fresh', 3);
  t.advance(100);
  assert.equal(c.get('long'), undefined);
  c.set('fresh', 33); // re-set refreshes
  t.advance(950);
  assert.equal(c.get('fresh'), 33);
});

test('M4: expired entries are reported as "expired"; prune removes them and keys() hides them', () => {
  const t = clock();
  const evicted: Array<[string, string]> = [];
  const c = new LRUCache<string, number>({ capacity: 5, now: t.now, onEvict: (k, _v, r) => evicted.push([k, r]) });
  c.set('a', 1, 50).set('b', 2, 50).set('c', 3); // c never expires
  t.advance(50);
  assert.deepEqual(c.keys(), ['c']);
  assert.equal(c.size, 3, 'lazy expiry: still stored until touched/pruned');
  assert.equal(c.prune(), 2);
  assert.equal(c.size, 1);
  assert.deepEqual(evicted.sort(), [['a', 'expired'], ['b', 'expired']]);
  assert.equal(c.prune(), 0);
});

test('M4: delete of an expired key returns false', () => {
  const t = clock();
  const c = new LRUCache<string, number>({ capacity: 2, ttlMs: 5, now: t.now });
  c.set('a', 1);
  t.advance(5);
  assert.equal(c.delete('a'), false);
});

// ---------- M5 (stretch): LFU ----------

test('M5: LFU evicts the least-frequently-used key', () => {
  const c = new LFUCache<string, number>({ capacity: 2 });
  c.set('a', 1).set('b', 2);
  c.get('a');
  c.get('a');
  c.get('b');
  c.set('c', 3); // b (freq 2) < a (freq 3)
  assert.equal(c.peek('b'), undefined);
  assert.equal(c.frequency('a'), 3);
  assert.equal(c.frequency('c'), 1);
  assert.equal(c.size, 2);
});

test('M5: LFU breaks frequency ties by evicting the least recently used', () => {
  const evicted: string[] = [];
  const c = new LFUCache<string, number>({ capacity: 3, onEvict: (k) => evicted.push(k) });
  c.set('a', 1).set('b', 2).set('c', 3);
  c.get('a');
  c.get('b'); // a,b freq 2 (b more recent); c freq 1
  c.set('d', 4); // evict c (min freq)
  c.get('d'); // d freq 2 — now a,b,d all freq 2; a is least recent at that freq
  c.set('e', 5);
  assert.deepEqual(evicted, ['c', 'a']);
});

test('M5: LFU overwrite counts as a use; peek does not; a new key resets minFreq to 1', () => {
  const c = new LFUCache<string, number>({ capacity: 2 });
  c.set('a', 1);
  c.set('a', 2);
  assert.equal(c.frequency('a'), 2);
  assert.equal(c.peek('a'), 2);
  assert.equal(c.frequency('a'), 2);
  c.set('b', 1);
  c.get('b');
  c.get('b'); // b freq 3
  c.set('x', 0); // evicts a (freq 2)
  assert.equal(c.peek('a'), undefined);
  c.set('y', 0); // x has freq 1 → evicted, not b
  assert.equal(c.peek('x'), undefined);
  assert.equal(c.peek('b'), 1);
});

test('M5: LFU delete keeps the structure consistent', () => {
  const c = new LFUCache<string, number>({ capacity: 2 });
  c.set('a', 1).set('b', 2);
  c.get('b');
  assert.equal(c.delete('a'), true);
  assert.equal(c.delete('a'), false);
  c.set('c', 3);
  c.set('d', 4); // c (freq 1) evicted, b survives
  assert.equal(c.peek('b'), 2);
  assert.equal(c.peek('c'), undefined);
  assert.equal(c.size, 2);
});

test('M5: LFU handles 200k operations quickly (O(1) per op)', () => {
  const c = new LFUCache<number, number>({ capacity: 1_000 });
  const start = process.hrtime.bigint();
  for (let i = 0; i < 200_000; i++) {
    c.set(i % 3_000, i);
    c.get((i * 7) % 3_000);
  }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.equal(c.size, 1_000);
  assert.ok(ms < 3_000, `took ${ms.toFixed(0)}ms`);
});
