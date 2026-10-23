import type { Topic } from '../../types';

const topic: Topic = {
  id: 'lld-lru-cache',
  phase: 'lld',
  order: 4,
  title: 'LRU Cache: Implementation & The Follow-up Ladder',
  subtitle:
    'The most-asked LLD question, done properly: where an LRU sits in a real system, the hash map + hand-written doubly linked list with sentinels and its pointer moves, a generic TypeScript implementation and how to test it. Then every rung of the follow-up ladder: weight, TTL, thread safety, O(1) LFU, scan resistance, pluggable policies, stats, listeners, write-back and distribution.',
  estimatedMinutes: 140,
  sources: [
    'Gamma et al. — Design Patterns (Strategy, Observer) applied to eviction policies and listeners',
    'Brian Goetz — Java Concurrency in Practice (Ch 11: lock striping; Ch 13: ReentrantLock)',
    'Einziger, Friedman, Manes — TinyLFU: A Highly Efficient Cache Admission Policy (ACM ToS 2017)',
    'Ben Manes — Caffeine design notes (W-TinyLFU, read/write buffers)',
    'O\'Neil, O\'Neil, Weikum — The LRU-K Page Replacement Algorithm (SIGMOD 1993); Johnson & Shasha — 2Q (VLDB 1994)',
    'Redis documentation — Key eviction (approximated LRU/LFU, maxmemory-samples)',
  ],
  tags: [
    'lld',
    'machine-coding',
    'lru',
    'lfu',
    'doubly-linked-list',
    'ttl',
    'thread-safety',
    'lock-striping',
    'w-tinylfu',
    'caffeine',
    'consistent-hashing',
    'redis-eviction',
  ],
  cheatSheet: [
    'LRU = HashMap<K, Node> + doubly linked list ordered by recency; sentinel head/tail remove every null check; get = unlink + pushFront; put on full = evict tail.prev and delete ITS key from the map (so Node must store its key).',
    'Doubly, not singly, linked: O(1) unlink needs node.prev. Hash map gives O(1) lookup of the node; the list gives O(1) order maintenance. Each structure alone fails one of the two.',
    'JS shortcut: Map keeps insertion order, so delete + set = move to MRU and keys().next() = LRU. A set() on an EXISTING key keeps its old position: updates must delete first. Interviewers may reject it as "using the library to do the problem".',
    'Weighted capacity: track totalWeight, evict in a LOOP until it fits, reject entries larger than the budget, and account for updates that grow an entry.',
    'TTL: lazy check on get (an expired hit is a miss) + bounded active sweep from the cold end; Redis does the same with sampled active expiry. Do not use one setTimeout per key.',
    'Thread safety: a get MUTATES the order, so a read lock is not enough. Java: synchronized / one ReentrantLock (simple, contended), lock striping into N segment LRUs (approximate global LRU), or Caffeine (lock-free reads via ring buffers, drained under tryLock).',
    'O(1) LFU: key→node, freq→DLL bucket, minFreq. get moves the node to bucket f+1 and bumps minFreq only if bucket f emptied and f was minFreq; insert sets minFreq = 1; evict the tail of the minFreq bucket.',
    'Scan resistance: plain LRU is flushed by a one-pass scan. SLRU/2Q keep new keys on probation; LRU-K ranks by K-th last access; W-TinyLFU admits a candidate only if its sketch frequency beats the victim\'s.',
    'Distributed: consistent hashing → per-node local LRU; exact global LRU needs a global order on every read (impractical). Redis samples maxmemory-samples keys (default 5) and evicts the oldest using a 24-bit LRU clock per object.',
    'Overhead per entry: ~80–150 bytes in V8 or the JVM (node object, map slot, key string) before your value. For millions of tiny values use index-based lists in typed arrays, or an off-heap or external cache.',
  ],
  sections: [
    {
      heading: 'HLD first: where an LRU actually lives, and what the interviewer is really asking',
      body: `**Intuition:** an LRU cache is a fixed-size shelf. When it is full and a new item arrives, the item nobody has touched for the longest time leaves. It is a bet that the recent past predicts the near future, which holds for most read-heavy web traffic.

**Where LRU-style eviction runs in a typical request path:**

| Layer | Example | Size | Latency | Eviction |
|---|---|---|---|---|
| **In-process L1** | \`lru-cache\` in a NestJS pod, Caffeine in a JVM | 10K–1M entries, 64 MB–2 GB heap | 0.1–1 µs | Exact LRU or W-TinyLFU per process |
| **Shared cache** | Redis / Memcached | GBs–TBs, sharded | 0.2–1 ms | Approximated LRU/LFU (sampling), per-slab LRU in Memcached |
| **CDN / edge** | CloudFront, Akamai, Varnish | TBs per PoP | 5–30 ms to user | LRU-ish with size awareness and TTLs |
| **Inside databases and OSes** | Postgres buffer pool (clock sweep), InnoDB (midpoint LRU), Linux page cache (active/inactive lists) | GBs | ns–µs | Scan-resistant LRU variants |

**Requirements to state before coding** (this is where seniors separate themselves):
- **Functional:** \`get(key)\`, \`put(key, value)\`, optional \`delete\`, capacity fixed at construction. Is capacity a **count or bytes**? Does \`get\` of a missing key return \`undefined\`/\`-1\`? Does \`put\` on an existing key update recency? (Yes, normally.)
- **Non-functional:** O(1) average for both operations, memory bounded, single-threaded for the first version. Ask "Will this be accessed from multiple threads?" now, because it changes the design later.
- **Out of scope for v1, mentioned as follow-ups:** TTL, weights, stats, listeners, concurrency, distribution.

**How the round usually runs:** 10 minutes to clarify and sketch, 20 to code a correct O(1) version, then the **ladder**: "make it thread-safe", "add TTL", "now make it LFU", "what about a batch job scanning everything?", "how does Redis do it?". Every rung reuses the core, so a clean core (one list abstraction, one map, nodes that know their key) pays off for the next 30 minutes.`,
      diagram: `  Request path: LRU-style eviction appears at every tier

  Client --> CDN PoP --------> API pod (NestJS) ---------> Redis ------> Postgres
             [LRU + TTL,       [L1: in-process LRU,       [approx LRU,   [buffer pool:
              size-aware]       10K-1M entries, ~1us]      sampled, ~0.5ms] clock sweep]
                                      |
                                      +-- what the LLD question asks you to build`,
      keyPoints: [
        'Clarify count vs bytes, update semantics, and threading before coding.',
        'The same idea runs at the CDN, L1, Redis and DB tiers, with different approximations.',
        'Design the core so the follow-ups (TTL, LFU, locks) reuse it.',
      ],
      source: 'Redis docs — Key eviction',
    },
    {
      heading: 'The data structure: why a hash map AND a doubly linked list',
      body: `**Intuition:** you need two things at once: find any item instantly (a hash map), and know which item is oldest and move items to "newest" instantly (a list ordered by recency). Neither structure does both, so you keep both and point one at the other.

**Why each alternative fails O(1):**

| Attempt | get | put / evict | Problem |
|---|---|---|---|
| Array of keys ordered by recency | O(n) to find and move | O(n) shift | The \`indexOf\` + \`splice\` trap |
| Hash map + timestamp per entry | O(1) | O(n) to find the minimum timestamp | Eviction scans everything |
| Hash map + min-heap on timestamp | O(log n) | O(log n) | Every get must re-heapify |
| Hash map + **singly** linked list | O(n) | O(n) | Unlinking needs the predecessor, so you must walk to find it |
| **Hash map → node of a doubly linked list** | **O(1)** | **O(1)** | ✔ |

**The key design decisions:**
- **The map stores node references, not values.** Lookup gives you the node, and the node's \`prev\`/\`next\` let you unlink it in O(1) without searching.
- **The node stores its key.** On eviction you start from the list's tail, so you have a node, not a key, yet you must delete it from the map. Forgetting this is the most common bug in a live round.
- **Sentinel head and tail.** Two dummy nodes that are never removed. Every real node always has a non-null \`prev\` and \`next\`, so \`unlink\` and \`pushFront\` have no special cases for empty list, single element, removing the head or removing the tail. Four branches of bug surface disappear.
- **Convention:** \`head.next\` = most recently used (MRU), \`tail.prev\` = least recently used (LRU). Either direction works; pick one and say it.

**Complexity:** O(1) average for get, put and delete (the hash map is O(1) average, O(n) worst under adversarial collisions; V8 and Java 8+ HashMap mitigate this with seeded hashing and tree bins respectively). Space is O(capacity).`,
      diagram: `  Class diagram (UML-ish)

  +---------------------------+            +---------------------+
  | LRUCache<K,V>             |  <>------- | Map<K, Node<K,V>>   |
  |---------------------------|            +---------------------+
  | - capacity: number        |                     | values point to
  | - head: Node (sentinel)   |                     v
  | - tail: Node (sentinel)   |  <>------- +---------------------+
  |---------------------------|            | Node<K,V>           |
  | + get(k): V | undefined   |            |---------------------|
  | + put(k, v): void         |            | key: K   (for evict)|
  | + delete(k): boolean      |            | value: V            |
  | - unlink(node)            |            | prev, next: Node    |
  | - pushFront(node)         |            +---------------------+
  +---------------------------+

  Memory layout:  map{ a->*, b->*, c->* }
                  HEAD <-> [c] <-> [a] <-> [b] <-> TAIL
                          MRU                LRU`,
      keyPoints: [
        'Map gives O(1) find; the doubly linked list gives O(1) reorder and evict.',
        'Nodes store their key so eviction can clean the map.',
        'Sentinels remove all empty/edge-case branches from pointer code.',
      ],
    },
    {
      heading: 'Pointer moves step by step: get, put-new, put-evict',
      body: `**Intuition:** every operation is built from two primitives. **unlink(node)** stitches the node's neighbours together. **pushFront(node)** splices it in right after \`head\`. Draw them once and every operation is a composition.

**unlink(x):** \`x.prev.next = x.next; x.next.prev = x.prev;\` Two writes. Sentinels guarantee both neighbours exist. Then null out \`x.prev\`/\`x.next\` to catch double-unlink bugs early.

**pushFront(x):** \`x.prev = head; x.next = head.next; head.next.prev = x; head.next = x;\` Four writes. **The order matters:** if you write \`head.next = x\` before reading \`head.next\` into \`x.next\`, you lose the old first node.

**get(k)** = map lookup, unlink, pushFront, return value.
**put(k, v) existing** = update value, unlink, pushFront.
**put(k, v) new, not full** = create node, map.set, pushFront.
**put(k, v) new, full** = victim = \`tail.prev\`, unlink(victim), \`map.delete(victim.key)\`, then insert as above.

**Interview tip:** narrate the pointer writes while drawing boxes. Interviewers watch for the "lost node" ordering bug in pushFront and for forgetting \`map.delete\` on eviction.`,
      diagram: `  Capacity 3. State: HEAD <-> C <-> A <-> B <-> TAIL     (B is LRU)

  1) get(A): unlink A, then pushFront A
     before:  HEAD <-> C <-> [A] <-> B <-> TAIL
     unlink:  C.next = B ; B.prev = C
              HEAD <-> C <-> B <-> TAIL        A floating
     push:    A.prev = HEAD ; A.next = C ; C.prev = A ; HEAD.next = A
     after:   HEAD <-> A <-> C <-> B <-> TAIL

  2) put(D) when full: evict TAIL.prev (= B)
     victim = TAIL.prev = B
     unlink B:   C.next = TAIL ; TAIL.prev = C
     map.delete(B.key)                    <- why the node stores its key
     pushFront D:
     after:   HEAD <-> D <-> A <-> C <-> TAIL

  3) put(C, newValue): exists -> update value, unlink C, pushFront C
     after:   HEAD <-> C <-> D <-> A <-> TAIL

  Wrong pushFront order (bug):
     HEAD.next = X   then   X.next = HEAD.next   -> X.next = X (self-loop)`,
      keyPoints: [
        'unlink = 2 writes, pushFront = 4 writes; read head.next before overwriting it.',
        'Eviction is always tail.prev with sentinels, never a null check.',
        'Updating an existing key is a recency touch too.',
      ],
    },
    {
      heading: 'Full TypeScript implementation with generics',
      body: `**Intuition:** keep it to one class with two private primitives. A reviewer should be able to verify correctness by reading \`unlink\` and \`pushFront\` once.

**Choices worth saying out loud:**
- **Generics \`<K, V>\`:** keys use \`Map\` SameValueZero equality, so object keys compare by reference. For composite keys (\`userId + locale\`), build a string key.
- **Constructor validation:** capacity must be a positive integer. A capacity of 0 is a degenerate case; decide whether it means "cache nothing" or an error, and test it.
- **\`get\` returns \`undefined\` on a miss**, not \`-1\` (LeetCode style), because \`-1\` is a valid value in real caches. If \`V\` may itself be \`undefined\`, expose \`has()\` or return a \`{ hit, value }\` result.
- **\`keys()\` generator in MRU→LRU order:** cheap to write and essential for tests that assert ordering.
- **Nulling pointers on unlink** helps GC slightly and turns a double-unlink into an immediate TypeError instead of silent corruption.

**What not to add in v1:** TTL, weights, locks and stats. Mention them as follow-ups; a clean, correct core in 20 minutes beats a feature-rich buggy one.`,
      code: [
        {
          language: 'typescript',
          title: 'LRUCache<K, V>: hash map + hand-written doubly linked list with sentinels',
          code: `class Node<K, V> {
  prev: Node<K, V> | null = null;
  next: Node<K, V> | null = null;
  constructor(public key: K, public value: V) {}
}

export class LRUCache<K, V> {
  private readonly map = new Map<K, Node<K, V>>();
  // Sentinels: head.next is the MRU entry, tail.prev is the LRU entry.
  private readonly head = new Node<K, V>(null as unknown as K, null as unknown as V);
  private readonly tail = new Node<K, V>(null as unknown as K, null as unknown as V);

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError('capacity must be a positive integer');
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  get size(): number { return this.map.size; }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;
    this.unlink(node);   // O(1): we hold the node, no search needed
    this.pushFront(node);
    return node.value;
  }

  put(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value; // update counts as a use
      this.unlink(existing);
      this.pushFront(existing);
      return;
    }
    if (this.map.size === this.capacity) {
      const lru = this.tail.prev!; // never the head sentinel, because size > 0
      this.unlink(lru);
      this.map.delete(lru.key);    // why Node stores its key
    }
    const node = new Node(key, value);
    this.map.set(key, node);
    this.pushFront(node);
  }

  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.unlink(node);
    return this.map.delete(key);
  }

  /** MRU -> LRU order, for tests and debugging. */
  *keys(): IterableIterator<K> {
    for (let n = this.head.next!; n !== this.tail; n = n.next!) yield n.key;
  }

  private unlink(node: Node<K, V>): void {
    node.prev!.next = node.next; // sentinels: prev/next are never null here
    node.next!.prev = node.prev;
    node.prev = node.next = null; // a double unlink now fails loudly
  }

  private pushFront(node: Node<K, V>): void {
    node.prev = this.head;
    node.next = this.head.next;  // read the old first node BEFORE overwriting head.next
    this.head.next!.prev = node;
    this.head.next = node;
  }
}`,
        },
      ],
      keyPoints: [
        'Two primitives (unlink, pushFront) carry all the pointer logic.',
        'Return undefined (or a result object) on miss; -1 is a LeetCode-ism.',
        'Expose keys() in recency order so tests can assert it.',
      ],
    },
    {
      heading: 'The JS Map shortcut: why it works and why interviewers may reject it',
      body: `**Intuition:** a JavaScript \`Map\` already remembers insertion order, so "move to most recent" can be "delete, then re-insert", and "least recent" is simply the first key. The language hands you a linked hash map.

**Why it is O(1):** V8 implements \`Map\` as a deterministic hash table (an ordered hash table: a hash index plus an entries array in insertion order). \`delete\` marks a slot as a hole; \`set\` appends; \`keys().next()\` skips holes from the front. All operations are amortised O(1), and the table compacts on rehash. This is the same idea as Java's \`LinkedHashMap\`, which threads a doubly linked list through its entries and supports \`accessOrder = true\` plus \`removeEldestEntry\`.

**The subtle trap:** \`map.set(existingKey, v)\` **keeps the original position**. An update that only calls \`set\` does not refresh recency, so you must \`delete\` and then \`set\`. The same applies to \`get\`.

**Why an interviewer may reject it:**
- The question tests whether you can design the structure. "Use the language's ordered map" answers a different question. Ask first: "May I use Map's insertion order, or would you like the list by hand?" Either answer is fine; not asking is the mistake.
- The follow-ups need the list. An O(1) LFU needs **many** ordered lists (one per frequency). SLRU and 2Q need two or three lists with moves between them. TTL sweeps need to walk from the cold end and stop. A hand-written list generalises; the Map trick does not.
- Performance is not the reason. The Map version is usually *faster* in V8 than hand-written node objects, because it allocates less and has better locality. Say that too; it shows you know the runtime.

**In production Node** you use \`lru-cache\` (isaacs). It is index-based internally (typed arrays for prev/next pointers, which cuts per-entry object overhead) and supports \`max\`, \`maxSize\` with \`sizeCalculation\`, \`ttl\`, \`dispose\` and \`fetchMethod\`.`,
      code: [
        {
          language: 'typescript',
          title: 'Map-based variant, including the update-position trap',
          code: `export class MapLRU<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key)!;
    this.map.delete(key);   // re-insert = move to the MRU end
    this.map.set(key, value);
    return value;
  }

  put(key: K, value: V): void {
    // TRAP: map.set(existingKey, v) keeps the OLD position. Delete first.
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      const lru = this.map.keys().next().value as K; // first key = least recent
      this.map.delete(lru);
    }
    this.map.set(key, value);
  }
}

// Java equivalent interviewers accept as "the library answer":
// class Lru<K,V> extends LinkedHashMap<K,V> {
//   Lru(int cap) { super(16, 0.75f, true); this.cap = cap; } // accessOrder = true
//   protected boolean removeEldestEntry(Map.Entry<K,V> e) { return size() > cap; }
// }`,
        },
      ],
      keyPoints: [
        'Map insertion order + delete/set gives an O(1) LRU in V8.',
        'set() on an existing key does not move it; delete first.',
        'Ask before using it: the LFU, SLRU and TTL follow-ups need a real list.',
      ],
    },
    {
      heading: 'Testing an LRU: examples, invariants and a differential test',
      body: `**Intuition:** an LRU has few lines and many interleavings. Hand-picked examples catch the obvious bugs; a randomised comparison against an obviously-correct slow model catches the rest in milliseconds.

**Three layers of tests:**
1. **Example tests** for the classic sequence: capacity 2, put a, put b, get a, put c → b evicted, order \`[c, a]\`. Update an existing key → it becomes MRU and the size is unchanged. Capacity 1. Delete of a missing key. Re-insert after eviction.
2. **Invariants** checked after every operation: \`size ≤ capacity\`; map size equals list length; walking forward from head and backward from tail gives the same sequence reversed; every map value is a node in the list.
3. **Differential (model-based) test:** a reference model built from an array with \`findIndex\` + \`splice\`. It is O(n) but too simple to be wrong. Run thousands of random operations with small key spaces (so collisions and evictions are frequent) and small capacities, and compare every \`get\` result and the full key order after each step. A seeded PRNG makes failures reproducible. fast-check can shrink a failing sequence to the minimal reproduction.

**In a live round:** write three example asserts and say "I'd add a model-based test against an array implementation". That sentence is often worth more than ten more examples.`,
      code: [
        {
          language: 'typescript',
          title: 'Example asserts plus a seeded differential test against a reference model',
          code: `import assert from 'node:assert/strict';
import { LRUCache } from './lru';

const c = new LRUCache<string, number>(2);
c.put('a', 1); c.put('b', 2);
assert.equal(c.get('a'), 1);              // a becomes MRU
c.put('c', 3);                             // evicts b
assert.equal(c.get('b'), undefined);
assert.deepEqual([...c.keys()], ['c', 'a']);

// Reference model: O(n), obviously correct.
function model(cap: number) {
  const arr: [number, number][] = [];
  return {
    get(k: number) {
      const i = arr.findIndex((e) => e[0] === k);
      if (i < 0) return undefined;
      const [e] = arr.splice(i, 1); arr.unshift(e); return e[1];
    },
    put(k: number, v: number) {
      const i = arr.findIndex((e) => e[0] === k);
      if (i >= 0) arr.splice(i, 1); else if (arr.length === cap) arr.pop();
      arr.unshift([k, v]);
    },
    keys: () => arr.map((e) => e[0]),
  };
}

let seed = 42; // seeded LCG: a failure is reproducible
const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

for (let trial = 0; trial < 200; trial++) {
  const cap = 1 + rnd(5);
  const real = new LRUCache<number, number>(cap);
  const ref = model(cap);
  for (let op = 0; op < 500; op++) {
    const k = rnd(8); // tiny key space => constant evictions and hits
    if (rnd(2)) assert.equal(real.get(k), ref.get(k));
    else { real.put(k, op); ref.put(k, op); }
    assert.deepEqual([...real.keys()], ref.keys()); // full order, every step
  }
}`,
        },
      ],
      keyPoints: [
        'Assert recency order, not just values.',
        'Differential testing against a trivial model catches pointer bugs fast.',
        'Small key spaces and capacities maximise evictions per operation.',
      ],
    },
    {
      heading: 'Follow-up 1: capacity by bytes (weight), and the real memory cost per entry',
      body: `**Intuition:** "1,000 entries" is meaningless when one entry is a 200-byte flag and another is a 3 MB product catalogue. Production caches are bounded by **bytes**, so each entry has a weight and the cache keeps the total under a budget.

**What changes from the count-based version:**
- A **weigher** function \`(key, value) → number\` (bytes, or any cost unit), computed once at insert and stored on the node. Never recompute it at eviction time: the value may have been mutated and the books would no longer balance.
- **Evict in a loop.** One 2 MB insert may need to evict forty 50 KB entries. "Evict one, then insert" is the classic bug (see the MCQ).
- **Reject oversized entries.** An entry heavier than the whole budget would evict everything and then still not fit. Refuse it, and drop any stale older version of that key.
- **Updates can grow an entry.** Adjust \`totalWeight += newW − oldW\`, then run the eviction loop. The entry being updated is MRU, so it is evicted last.

**What does an entry really cost?** Your value plus the per-entry overhead (64-bit, pointer-compressed V8 or a JVM with compressed oops):

| Component | V8 (hand-written list) | JVM (LinkedHashMap) |
|---|---|---|
| Node / Entry object | ~32 B (header + key, value, prev, next) | ~40 B (header, hash, key, value, next, before, after) |
| Hash table slot(s) | ~12–24 B in the Map's backing store | 4–8 B bucket slot at load factor 0.75 |
| Key, a 32-char ASCII string | ~48 B | ~72 B (String 24 B + byte[] 48 B) |
| **Overhead before the value** | **~90–110 B** | **~115–125 B** |

For 1M entries, that is ~100 MB of pure bookkeeping. For tiny values (counters, flags, IDs) the overhead exceeds the data. Options: an index-based list in typed arrays (\`Uint32Array\` prev/next, as \`lru-cache\` does), Caffeine (also compact), or an off-heap or external store (Redis, which has its own ~50–70 B overhead per key).

**Weigher accuracy:** \`Buffer.byteLength(JSON.stringify(v))\` approximates serialised size, not heap size. A JS object's heap footprint is often 2–4× its JSON. Pick a proxy, calibrate it with a heap snapshot once, and document it.`,
      code: [
        {
          language: 'typescript',
          title: 'WeightedLRU: byte budget, eviction loop, oversized rejection, growing updates',
          code: `import { DList, LNode } from './dlist'; // the same unlink/pushFront code, extracted

export type Weigher<K, V> = (key: K, value: V) => number;

export class WeightedLRU<K, V> {
  private readonly map = new Map<K, LNode<K, V>>();
  private readonly list = new DList<K, V>();
  private totalWeight = 0;

  constructor(
    private readonly maxWeight: number,          // e.g. 64 * 1024 * 1024 bytes
    private readonly weigh: Weigher<K, V>,
    private readonly onEvict?: (key: K, value: V) => void,
  ) {}

  get weight(): number { return this.totalWeight; }

  get(key: K): V | undefined {
    const n = this.map.get(key);
    if (!n) return undefined;
    this.list.moveToFront(n);
    return n.value;
  }

  /** Returns false when the entry alone exceeds the budget (it is never cached). */
  put(key: K, value: V): boolean {
    const w = this.weigh(key, value); // computed ONCE and stored on the node
    if (!Number.isFinite(w) || w < 0) throw new RangeError('weigher must return a finite, non-negative number');
    if (w > this.maxWeight) { this.delete(key); return false; } // also drop the stale old version
    const old = this.map.get(key);
    if (old) {
      this.totalWeight += w - old.weight; // the update may GROW the entry
      old.value = value;
      old.weight = w;
      this.list.moveToFront(old);
    } else {
      const n = new LNode(key, value, w);
      this.map.set(key, n);
      this.list.pushFront(n);
      this.totalWeight += w;
    }
    while (this.totalWeight > this.maxWeight) { // one insert may evict MANY entries
      const victim = this.list.peekBack()!;
      this.removeNode(victim);
      this.onEvict?.(victim.key, victim.value);
    }
    return true;
  }

  delete(key: K): boolean {
    const n = this.map.get(key);
    if (!n) return false;
    this.removeNode(n);
    return true;
  }

  private removeNode(n: LNode<K, V>): void {
    this.list.remove(n);
    this.map.delete(n.key);
    this.totalWeight -= n.weight;
  }
}
// new WeightedLRU<string, string>(64 << 20, (k, v) => 2 * (k.length + v.length) + 100)`,
        },
      ],
      keyPoints: [
        'Weigh once at insert, store the weight, and evict in a loop.',
        'Reject entries heavier than the budget, and handle updates that grow.',
        'Budget ~100 bytes of overhead per entry in V8/JVM before counting your value.',
      ],
      source: 'Caffeine wiki — Eviction (maximumWeight, Weigher); lru-cache docs — maxSize/sizeCalculation',
    },
    {
      heading: 'Follow-up 2: TTL with lazy and active expiry',
      body: `**Intuition:** recency answers "what to drop when full"; TTL answers "what is too old to trust". They are independent, so an entry can be recent and expired at the same time. You need both a check at read time (never serve stale data) and some background reclaiming (never hold dead data forever).

**Lazy expiry (mandatory):** store \`expiresAt\` on the node. On \`get\`, if \`expiresAt <= now()\`, remove it and return a miss. This alone guarantees **correctness**: no expired value is ever returned.

**Active expiry (for memory):** lazily-expired entries that are never read again sit in memory until LRU pushes them out. Options:
- **Sweep from the cold end with a budget** (shown below). Hot expired entries get caught lazily by reads; cold expired ones drift to the tail, where the sweep finds them. Together the two cover almost everything at O(budget) per tick.
- **Prefer reclaiming an expired entry over evicting a live one** when the cache is full.
- **Uniform TTL (the same TTL for every entry):** expiry order equals write order, so a second list ordered by write time gives exact O(1) expiry from its head.
- **Per-entry TTLs:** a min-heap (O(log n)) or a **hierarchical timing wheel** (O(1) amortised; Caffeine uses one for \`expireAfter\`; Kafka uses one for request timeouts).
- **Redis's approach:** sample 20 keys that have a TTL, 10 times per second; if more than 25% were expired, repeat. That is probabilistic and bounded in CPU.

**Do not** create one \`setTimeout\` per key: a million timers, closures that pin evicted values, and stale timers that delete a *newer* value written under the same key.

**Semantics to settle with the interviewer:** does \`get\` extend the TTL (sliding expiration, as for sessions) or not (absolute expiration, as for data freshness)? Does \`put\` on an existing key reset it? Inject the clock so the tests are deterministic.`,
      code: [
        {
          language: 'typescript',
          title: 'TtlLRU: lazy expiry on read, budgeted sweep from the cold end, injectable clock',
          code: `import { DList, LNode } from './dlist'; // LNode carries expiresAt

export class TtlLRU<K, V> {
  private readonly map = new Map<K, LNode<K, V>>();
  private readonly list = new DList<K, V>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly capacity: number,
    private readonly defaultTtlMs: number,
    private readonly now: () => number = Date.now, // injectable clock for tests
  ) {}

  get(key: K): V | undefined {
    const n = this.map.get(key);
    if (!n) return undefined;
    if (n.expiresAt <= this.now()) { this.removeNode(n); return undefined; } // LAZY: expired hit = miss
    this.list.moveToFront(n); // absolute TTL: reading does NOT extend it
    return n.value;
  }

  put(key: K, value: V, ttlMs = this.defaultTtlMs): void {
    const expiresAt = this.now() + ttlMs;
    const old = this.map.get(key);
    if (old) { old.value = value; old.expiresAt = expiresAt; this.list.moveToFront(old); return; }
    if (this.map.size >= this.capacity) {
      if (this.sweep(8) === 0) this.removeNode(this.list.peekBack()!); // prefer dropping a dead entry
    }
    const n = new LNode(key, value, 1, expiresAt);
    this.map.set(key, n);
    this.list.pushFront(n);
  }

  /** ACTIVE expiry: walk at most 'budget' nodes from the LRU end. */
  sweep(budget = 100): number {
    const t = this.now();
    let removed = 0;
    let n = this.list.tail.prev!;
    while (n !== this.list.head && budget-- > 0) {
      const prev = n.prev!; // capture before removal unlinks n
      if (n.expiresAt <= t) { this.removeNode(n); removed++; }
      n = prev;
    }
    return removed;
  }

  startJanitor(everyMs = 1_000, budget = 200): void {
    this.timer = setInterval(() => this.sweep(budget), everyMs);
    this.timer.unref(); // the janitor must never keep the process alive
  }

  stopJanitor(): void { clearInterval(this.timer); }

  private removeNode(n: LNode<K, V>): void {
    this.list.remove(n);
    this.map.delete(n.key);
  }
}`,
        },
      ],
      keyPoints: [
        'Lazy expiry gives correctness; active expiry reclaims memory.',
        'Sweep from the cold end with a budget; reads catch hot expired keys.',
        'No per-key timers; decide sliding vs absolute TTL explicitly.',
      ],
      source: 'Redis docs — EXPIRE (how Redis expires keys); Varghese & Lauck — Hashed and Hierarchical Timing Wheels (1987)',
    },
    {
      heading: 'Follow-up 3: thread safety in Java, async safety in Node, and multiple pods',
      body: `**Intuition:** in an LRU, **every read is a write**: \`get\` moves the node to the front. So "reads are safe, lock only writes" is wrong from the start, and a \`ReadWriteLock\` with \`get\` under the read lock corrupts the list (two readers both relinking nodes).

**Java options, in the order interviewers expect:**

| Option | How | Throughput | Trap |
|---|---|---|---|
| \`synchronized\` on all methods / \`Collections.synchronizedMap(new LinkedHashMap(.., true))\` | One monitor | Fine to ~1M ops/s; cache-line ping-pong beyond | Iteration still needs manual sync; one hot lock |
| One \`ReentrantLock\` | Explicit lock/unlock in try/finally | Similar to synchronized | Adds \`tryLock\`/timeouts and fairness options, not throughput |
| **\`ConcurrentHashMap\` + \`ConcurrentLinkedDeque\`** | "Both are thread-safe, so the combination is" | **Wrong** | \`deque.remove(key)\` is O(n); map and deque updates are not atomic together, so you get duplicate deque entries, size drift and evicting a key that was just re-read |
| **Lock striping** | N independent LRU segments, \`segment = hash(key) & (N−1)\`, each with its own lock | ~N× less contention | Global order is only **approximate**: each segment evicts its own LRU, and a skewed hash overloads one segment |
| **Caffeine** | ConcurrentHashMap for data; reads append to striped lock-free ring buffers; the policy is updated in batches under \`tryLock\` | 100M+ reads/s reported in benchmarks | Recency is applied lazily and buffers may drop events under extreme load (acceptable, by design) |

**Node:** one event loop, so a synchronous \`get\`/\`put\` is atomic. Problems start when you **await mid-operation**: a loading cache that awaits the DB between "miss" and "insert" lets 500 concurrent misses trigger 500 loads (stampede) and lets a slow, stale load overwrite a fresher value. Fix: keep the cache ops synchronous and coalesce misses with one in-flight promise per key (shown below), and make invalidation cancel a racing load's right to publish.

**Multiple pods:** each pod has its own LRU, so there is no shared recency and invalidation must be broadcast (Pub/Sub) or bounded by a short TTL. No lock in one process can make N caches consistent. That is the distributed follow-up.`,
      code: [
        {
          language: 'java',
          title: 'Lock-striped LRU: N LinkedHashMap segments, one ReentrantLock each',
          code: `import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;

public final class StripedLruCache<K, V> {
    private static final class Segment<K, V> {
        final ReentrantLock lock = new ReentrantLock();
        final LinkedHashMap<K, V> map;
        Segment(final int cap) {
            // accessOrder = true: get() moves the entry to the MRU end
            this.map = new LinkedHashMap<K, V>(16, 0.75f, true) {
                @Override protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
                    return size() > cap;
                }
            };
        }
    }

    private final Segment<K, V>[] segments;
    private final int mask;

    @SuppressWarnings("unchecked")
    public StripedLruCache(int capacity, int concurrency) {
        int n = 1;
        while (n < concurrency) n <<= 1;               // power of two => mask instead of modulo
        segments = (Segment<K, V>[]) new Segment[n];
        for (int i = 0; i < n; i++) segments[i] = new Segment<>(Math.max(1, capacity / n));
        mask = n - 1;
    }

    private Segment<K, V> segmentFor(Object key) {
        int h = key.hashCode();
        h ^= (h >>> 16);                               // spread high bits, as HashMap does
        return segments[h & mask];
    }

    public V get(K key) {
        Segment<K, V> s = segmentFor(key);
        s.lock.lock();                                 // even reads lock: get() reorders the list
        try { return s.map.get(key); } finally { s.lock.unlock(); }
    }

    public void put(K key, V value) {
        Segment<K, V> s = segmentFor(key);
        s.lock.lock();
        try { s.map.put(key, value); } finally { s.lock.unlock(); }
    }
}`,
        },
        {
          language: 'typescript',
          title: 'Node: synchronous cache ops + one in-flight load per key (no stampede, no stale publish)',
          code: `export class LoadingCache<V> {
  private readonly inFlight = new Map<string, Promise<V>>();

  constructor(private readonly lru: LRUCache<string, V>, private readonly load: (k: string) => Promise<V>) {}

  get(key: string): Promise<V> {
    const hit = this.lru.get(key);            // sync: nothing interleaves here
    if (hit !== undefined) return Promise.resolve(hit);
    const pending = this.inFlight.get(key);
    if (pending) return pending;              // 500 concurrent misses => 1 load
    const p = this.load(key)
      .then((v) => {
        if (this.inFlight.get(key) === p) this.lru.put(key, v); // publish only if not invalidated meanwhile
        return v;
      })
      .finally(() => { if (this.inFlight.get(key) === p) this.inFlight.delete(key); });
    this.inFlight.set(key, p);
    return p;
  }

  invalidate(key: string): void {
    this.inFlight.delete(key);                // a racing load loses its right to publish
    this.lru.delete(key);
  }
}`,
        },
      ],
      keyPoints: [
        'get mutates order, so readers need exclusive access to the list.',
        'Two concurrent collections do not make a compound operation atomic.',
        'Striping trades exact global LRU for N× less contention; Node needs no lock until an await splits an operation.',
      ],
      source: 'Brian Goetz — Java Concurrency in Practice, Ch 11.4 (lock striping); Ben Manes — Caffeine design (concurrency)',
    },
    {
      heading: 'Follow-up 4: LFU in O(1) with frequency buckets and a min-frequency pointer',
      body: `**Intuition:** LFU evicts the item used **least often**, breaking ties by least recent. The naive version scans every entry for the smallest count, O(n). The O(1) trick is to group entries into **buckets by frequency**, each bucket being its own small LRU list, and to remember which bucket is the lowest.

**Structures:**
- \`nodes: Map<K, Node>\`, where a node holds key, value and \`freq\`.
- \`buckets: Map<freq, DList>\`, where each list is ordered by recency within that frequency.
- \`minFreq\`: the smallest frequency that currently has a non-empty bucket.

**Operations:**
- **get / update (touch):** remove the node from bucket \`f\` and push it to the front of bucket \`f+1\`. If bucket \`f\` is now empty **and** \`f === minFreq\`, set \`minFreq = f + 1\`. It can only move up by one, because the node that left now sits at \`f+1\`.
- **insert new:** if full, evict \`buckets[minFreq].tail.prev\` (least frequent, then least recent) and delete its key from \`nodes\`. Then insert at frequency 1 and **set \`minFreq = 1\`**. A new key is always the least frequent.
- Everything is O(1): map lookups, list splices, and a pointer bump.

**Why minFreq never needs a scan:** it changes only in the two situations above (a touch that empties the minimum bucket, or an insert that resets it to 1). Eviction never needs to recompute it, because an insert follows immediately and resets it.

**LFU's production problem: frequency never decays.** Yesterday's viral item with 1M hits outlives everything new, which is cache pollution. Fixes: periodically halve all counts (aging), use windowed counts, or use W-TinyLFU, which decays a compact sketch rather than per-entry counters. **Also:** classic LFU forgets the frequency on eviction, so a key that bounces in and out starts at 1 each time. TinyLFU's sketch remembers frequencies of keys that are *not* in the cache, which is its real advantage.`,
      diagram: `  minFreq = 1      capacity 4

  freq 1: HEAD <-> [d] <-> [c] <-> TAIL      <- evict c (least freq, least recent)
  freq 2: HEAD <-> [b] <-> TAIL
  freq 5: HEAD <-> [a] <-> TAIL

  get(c):  remove c from freq1, push to freq2 front
  freq 1: HEAD <-> [d] <-> TAIL               (non-empty: minFreq stays 1)
  freq 2: HEAD <-> [c] <-> [b] <-> TAIL

  get(d):  freq1 becomes empty AND minFreq == 1  ->  minFreq = 2
  freq 2: HEAD <-> [d] <-> [c] <-> [b] <-> TAIL

  put(e) when full: evict freq2.TAIL.prev = b; insert e at freq1; minFreq = 1`,
      code: [
        {
          language: 'typescript',
          title: 'LFUCache<K, V>: O(1) get/put with frequency buckets',
          code: `import { DList, LNode } from './dlist'; // node gets an extra 'freq' field here

type FNode<K, V> = LNode<K, V> & { freq: number };

export class LFUCache<K, V> {
  private readonly nodes = new Map<K, FNode<K, V>>();
  private readonly buckets = new Map<number, DList<K, V>>();
  private minFreq = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new RangeError('capacity must be > 0');
  }

  get(key: K): V | undefined {
    const n = this.nodes.get(key);
    if (!n) return undefined;
    this.touch(n);
    return n.value;
  }

  put(key: K, value: V): void {
    const n = this.nodes.get(key);
    if (n) { n.value = value; this.touch(n); return; }
    if (this.nodes.size === this.capacity) {
      const bucket = this.buckets.get(this.minFreq)!;
      const victim = bucket.peekBack()!;             // least frequent, then least recent
      bucket.remove(victim);
      if (bucket.size === 0) this.buckets.delete(this.minFreq);
      this.nodes.delete(victim.key);
    }
    const fresh = Object.assign(new LNode(key, value), { freq: 1 });
    this.nodes.set(key, fresh);
    this.bucket(1).pushFront(fresh);
    this.minFreq = 1;                                // a new key is always the least frequent
  }

  private touch(n: FNode<K, V>): void {
    const old = this.buckets.get(n.freq)!;
    old.remove(n);
    if (old.size === 0) {
      this.buckets.delete(n.freq);
      if (this.minFreq === n.freq) this.minFreq++;  // only n left, and it moved to freq + 1
    }
    n.freq++;
    this.bucket(n.freq).pushFront(n);
  }

  private bucket(f: number): DList<K, V> {
    let b = this.buckets.get(f);
    if (!b) { b = new DList<K, V>(); this.buckets.set(f, b); }
    return b;
  }
}`,
        },
      ],
      keyPoints: [
        'Buckets by frequency, each an LRU list; minFreq points at the eviction bucket.',
        'minFreq moves only on touch-empties-min (+1) and on insert (reset to 1).',
        'Plain LFU never forgets: add aging or use W-TinyLFU.',
      ],
      source: 'Shah, Mitra, Matani — An O(1) algorithm for implementing the LFU cache eviction scheme (2010)',
    },
    {
      heading: 'Follow-up 5: scan resistance with LRU-K, 2Q, SLRU and W-TinyLFU',
      body: `**Intuition:** LRU assumes "used once recently" means "will be used again". A sequential scan (a nightly export, a crawler, a \`SELECT *\` warming the cache) touches every key exactly once, and under LRU each of those one-hit wonders evicts a genuinely hot item. Scan-resistant policies make a new key **earn** its place.

| Policy | Idea | Cost | Notes |
|---|---|---|---|
| **LRU-K** (usually K=2) | Rank by the time of the K-th most recent access; keys seen once have infinite backward distance and go first | Keep the last K timestamps per key, plus history for recently evicted keys; heap-ordered, O(log n) | Database buffer pools (the original paper) |
| **2Q** | New keys enter a small FIFO (A1in, ~25%); a hit while in a "ghost" list of recently evicted keys (A1out) promotes to the main LRU (Am) | O(1), two lists + a ghost map | Simple and strong; ghosts cost memory |
| **SLRU** (segmented) | Probation segment (~20%) + protected segment (~80%); a hit in probation promotes to protected; protected overflow demotes to probation's head | O(1), two DLLs | What Caffeine uses for its main region |
| **W-TinyLFU** (Caffeine) | 1% **window LRU** admits everything; candidates leaving the window compete with the main SLRU's victim, and the one with the higher **Count-Min Sketch** frequency stays | O(1); the sketch is ~8 bytes per entry, aged by halving all counters every ~10 × capacity samples | Near-optimal hit ratio across very different traces |

**Why W-TinyLFU wins in practice:** the sketch remembers frequency for keys that are **not** in the cache, so a key that keeps coming back gets admitted, while a one-hit wonder from a scan loses the admission duel against an established victim and never displaces it. The small window keeps bursty, recency-heavy patterns (new trending items) working. Periodic halving lets old popularity fade.

**MySQL InnoDB's midpoint insertion** is the same idea in a database: new pages enter at 3/8 from the tail (\`innodb_old_blocks_pct\` = 37), and only move to the young sublist if they are accessed again after \`innodb_old_blocks_time\` (1,000 ms). A table scan churns the old sublist and leaves the young one intact.

**Implementation sketch for SLRU in a round:** two instances of your DList, two counts. On a hit in probation, move the node to the protected front. If protected is over its cap, demote protected's tail to probation's front. Evict from probation's tail. That is about 30 extra lines on top of your core, which is a strong answer to "how would you fix the scan problem in code".`,
      diagram: `  SLRU (Caffeine main region)               W-TinyLFU admission

  new key                                   new key -> [ window LRU ~1% ]
     |                                                        | evicted candidate C
     v                                                        v
  +-------------------+  hit   +----------------+   freq(C) > freq(V) ?  (count-min sketch)
  | probation (~20%)  | -----> | protected (~80%)|        yes -> C enters main, V evicted
  +-------------------+        +----------------+        no  -> C dropped (scan victim)
     | tail = victim  <--------  demote overflow
     v
   evicted                                  sketch: 4 hashes x 4-bit counters,
                                            halve all every ~10 x capacity samples`,
      keyPoints: [
        'A one-pass scan flushes plain LRU; new keys must prove themselves.',
        'SLRU and 2Q are O(1) and easy to code on top of your list.',
        'W-TinyLFU = small window LRU + SLRU + frequency-sketch admission with aging.',
      ],
      source: 'Einziger, Friedman, Manes — TinyLFU (2017); O\'Neil et al. — LRU-K (1993); Johnson & Shasha — 2Q (1994); MySQL docs — Making the Buffer Pool Scan Resistant',
    },
    {
      heading: 'Follow-up 6: pluggable eviction via Strategy, plus stats and hit ratio',
      body: `**Intuition:** the storage (map), the bookkeeping (stats, listeners) and the decision of **who to evict** change for different reasons. Split them: the cache owns storage and bookkeeping, and an \`EvictionPolicy\` strategy only answers "which key goes next?".

**The policy interface needs four hooks:** \`onInsert(k)\`, \`onAccess(k)\`, \`onRemove(k)\` and \`victim()\`. LRU moves on access; FIFO ignores access; LFU bumps a frequency; a random policy ignores everything. The cache calls the hooks; the policy owns its own ordering structure. The interface is the same one the LFU and SLRU sections implement, just behind a seam.

**The cost of the abstraction:** an extra virtual call per operation (nanoseconds) and, if each policy keeps its own ordering structure keyed by \`K\`, a second hash lookup. Caffeine avoids this by fusing the policy into its node classes (code-generated per configuration). In an interview, the clean seam is the right answer, and fusing is a performance footnote.

**Stats that matter, and how they get faked:**
- **Hit ratio = hits ÷ (hits + misses)**, measured over a window (e.g. per minute), not since boot. A lifetime ratio hides a regression that started an hour ago.
- **Count an expired entry found on read as a miss**, otherwise TTL'd caches look perfect while serving nothing.
- **Coalesced waiters** (the in-flight promise) are neither pure hits nor loads. Count them separately as \`coalesced\` so "loads per second" stays honest.
- **Eviction count by cause** (size, expired, explicit, replaced). A rising size-eviction rate with a falling hit ratio means the cache is too small for the working set. Expired evictions dominating means the TTL is the limiter.
- Export to Prometheus as **counters** (\`cache_requests_total{result="hit|miss"}\`) and compute ratios in PromQL. Never export a pre-computed ratio gauge, because it cannot be aggregated across pods.

**Listeners** use the Observer pattern: \`onRemoval((key, value, cause) => ...)\`. Isolate them with try/catch per listener so one bad listener cannot corrupt cache state mid-operation, and never let a listener call back into the cache synchronously, since the cache may be in the middle of an eviction.`,
      code: [
        {
          language: 'typescript',
          title: 'PolicyCache: Strategy for eviction, removal causes, isolated listeners, stats',
          code: `export interface EvictionPolicy<K> {
  onInsert(key: K): void;
  onAccess(key: K): void;
  onRemove(key: K): void;
  victim(): K | undefined;
}

export class LruPolicy<K> implements EvictionPolicy<K> {
  private readonly order = new Set<K>(); // first = least recent
  onInsert(k: K) { this.order.add(k); }
  onAccess(k: K) { this.order.delete(k); this.order.add(k); }
  onRemove(k: K) { this.order.delete(k); }
  victim() { return this.order.values().next().value; }
}
export class FifoPolicy<K> implements EvictionPolicy<K> {
  private readonly order = new Set<K>();
  onInsert(k: K) { this.order.add(k); }
  onAccess(_k: K) { /* FIFO ignores reads by design */ }
  onRemove(k: K) { this.order.delete(k); }
  victim() { return this.order.values().next().value; }
}

export type RemovalCause = 'SIZE' | 'EXPLICIT' | 'REPLACED';

export class PolicyCache<K, V> {
  private readonly store = new Map<K, V>();
  private hits = 0; private misses = 0; private evictions = 0;
  private readonly listeners: ((k: K, v: V, cause: RemovalCause) => void)[] = [];

  constructor(private readonly capacity: number, private readonly policy: EvictionPolicy<K>) {}

  onRemoval(fn: (k: K, v: V, cause: RemovalCause) => void): void { this.listeners.push(fn); }

  get(key: K): V | undefined {
    if (!this.store.has(key)) { this.misses++; return undefined; }
    this.hits++;
    this.policy.onAccess(key);
    return this.store.get(key);
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      const old = this.store.get(key)!;
      this.store.set(key, value);
      this.policy.onAccess(key);
      return this.emit(key, old, 'REPLACED');
    }
    if (this.store.size >= this.capacity) {
      const victim = this.policy.victim()!;
      const v = this.store.get(victim)!;
      this.store.delete(victim);
      this.policy.onRemove(victim);
      this.evictions++;
      this.emit(victim, v, 'SIZE');
    }
    this.store.set(key, value);
    this.policy.onInsert(key);
  }

  stats() {
    const total = this.hits + this.misses;
    return { hits: this.hits, misses: this.misses, evictions: this.evictions, hitRatio: total ? this.hits / total : 0 };
  }

  private emit(k: K, v: V, cause: RemovalCause): void {
    for (const l of this.listeners) {
      try { l(k, v, cause); } catch (err) { console.error('removal listener failed', err); } // isolate
    }
  }
}
// new PolicyCache<string, Product>(10_000, new LruPolicy()) — swap in FifoPolicy / an SLRU policy freely`,
        },
      ],
      keyPoints: [
        'The cache owns storage, stats and listeners; the policy only picks victims.',
        'Measure hit ratio per window, count expired reads as misses, export counters not ratios.',
        'Removal listeners carry a cause and are isolated from each other.',
      ],
      source: 'Gamma et al. — Strategy, Observer; Caffeine wiki — Statistics, Removal',
    },
    {
      heading: 'Follow-up 7: write-through and write-back hooks, and eviction listeners that persist',
      body: `**Intuition:** so far the cache only **forgets**. If it is also the place writes land first (write-back), eviction stops being "drop it" and becomes "save it, then drop it". A dirty entry evicted without a flush is lost data.

**Write policies as hooks on the same LRU:**

| Policy | On put | On eviction | Risk |
|---|---|---|---|
| **Write-through** | Write the store synchronously, then the cache | Just drop | Write latency = store latency; the cache is never the only copy |
| **Write-back (write-behind)** | Mark dirty, return immediately | **Flush dirty entries**, then drop | Crash loses dirty data; read-after-evict can see a stale store |
| **Write-around** | Write the store only, invalidate the cache | Just drop | The next read misses |

**The write-back details interviewers probe:**
1. **Read during flush:** a dirty entry is evicted and its \`save\` is in flight. A \`get\` that misses and loads from the store reads the **old** value. Keep evicted-but-unflushed values in a \`flushing\` map and serve reads from it until the save completes.
2. **Ordering per key:** key \`a\` is evicted (save a=1 starts), re-written to 10, and evicted again (save a=10 starts). If the second save lands first, the store ends at 1. Chain flushes per key.
3. **Load races:** a \`get\` starts loading \`x\` from the store; a \`set(x, 99)\` lands during the await. The loaded value must not overwrite the newer dirty one.
4. **Shutdown:** \`flushAll()\` on SIGTERM, within the pod's grace period (30 s by default in Kubernetes). Anything that must survive a crash should not be write-back in process; use a write-ahead log or a durable queue.
5. **Flush failures:** report through a hook, retry with backoff, and decide whether to re-insert as dirty (bounded) or dead-letter. Never retry silently forever.

**Real-world shape:** write-back caches are common inside databases (buffer pools flush dirty pages at checkpoints with WAL for crash safety) and in counters (aggregate view counts in memory, flush every few seconds). For business entities, write-through or cache-aside is the safer default.`,
      code: [
        {
          language: 'typescript',
          title: 'WriteBackLRU: dirty tracking, flush-on-evict, read-your-writes during flush, per-key ordering',
          code: `export interface BackingStore<K, V> {
  load(key: K): Promise<V | undefined>;
  save(key: K, value: V): Promise<void>;
}
type Entry<V> = { value: V; dirty: boolean };

export class WriteBackLRU<K, V> {
  private readonly entries = new Map<K, Entry<V>>(); // Map order = recency, for brevity
  private readonly flushing = new Map<K, { value: V; done: Promise<void> }>();

  constructor(private readonly capacity: number, private readonly store: BackingStore<K, V>,
              private readonly onFlushError: (key: K, err: unknown) => void) {}

  async get(key: K): Promise<V | undefined> {
    const e = this.entries.get(key);
    if (e) { this.entries.delete(key); this.entries.set(key, e); return e.value; }
    const pending = this.flushing.get(key);
    if (pending) return pending.value;              // evicted, not yet persisted: store is stale
    const loaded = await this.store.load(key);
    if (loaded !== undefined && !this.entries.has(key)) this.insert(key, { value: loaded, dirty: false });
    return this.entries.get(key)?.value ?? loaded;  // a set() during the await wins
  }

  set(key: K, value: V): void { this.insert(key, { value, dirty: true }); }

  async flushAll(): Promise<void> {                 // call on SIGTERM
    for (const [k, e] of this.entries) if (e.dirty) { e.dirty = false; this.flush(k, e.value); }
    await Promise.all([...this.flushing.values()].map((f) => f.done));
  }

  private insert(key: K, entry: Entry<V>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > this.capacity) {
      const [victimKey, victim] = this.entries.entries().next().value as [K, Entry<V>];
      this.entries.delete(victimKey);
      if (victim.dirty) this.flush(victimKey, victim.value); // the eviction hook persists
    }
  }

  private flush(key: K, value: V): void {
    const prev = this.flushing.get(key)?.done ?? Promise.resolve();
    const done: Promise<void> = prev                // chain per key: saves land in order
      .then(() => this.store.save(key, value))
      .catch((err) => this.onFlushError(key, err))
      .finally(() => { if (this.flushing.get(key)?.done === done) this.flushing.delete(key); });
    this.flushing.set(key, { value, done });
  }
}`,
        },
      ],
      keyPoints: [
        'Write-back turns eviction into a persistence event.',
        'Serve reads from in-flight flushes; chain saves per key; do not let loads clobber dirty writes.',
        'flushAll on shutdown; crash-safety needs a WAL, not a cache.',
      ],
      source: 'Caffeine wiki — Writer / write-behind examples; Designing Data-Intensive Applications — Ch 3 (WAL)',
    },
    {
      heading: 'Follow-up 8: distributed LRU, consistent hashing, and how Redis approximates LRU',
      body: `**Intuition:** once the cache spans 10 nodes, "least recently used" would require one global timeline of every read across all nodes. Each read would update a shared structure over the network, so the cache would become slower than the database it protects. Real systems give up exact global LRU and keep **local** LRU per shard.

**Partitioning:** consistent hashing with virtual nodes (100–200 per physical node) maps each key to one node. Each node runs its own LRU over its shard. Adding an 11th node remaps about 1/11 ≈ 9% of keys (those keys miss once and refill), compared with ~91% for \`hash % N\`. Redis Cluster uses 16,384 hash slots, a fixed-slot variant of the same idea.

**Why exact global LRU is impractical:**
- **Write amplification:** every \`get\` becomes a write to a global order. At 1M reads/s that is 1M cross-node ordering updates per second.
- **Coordination:** a global list needs a single owner (a bottleneck) or a consensus protocol (milliseconds per op).
- **It is not even desirable:** with good hashing, per-shard LRU approximates global LRU closely, because each shard sees a uniform sample of the key space.

**How Redis approximates LRU on one node:** each object stores a **24-bit LRU clock** (seconds resolution, wraps every ~194 days), with no linked list (which would cost two pointers, 16 bytes, per key, plus pointer writes on every read). On eviction, Redis samples \`maxmemory-samples\` keys (default **5**) and evicts the one with the oldest clock, keeping a 16-entry **eviction pool** of good candidates across rounds (since 3.0) to improve accuracy. With 10 samples it is very close to true LRU, at more CPU per eviction. \`allkeys-lfu\` reuses the same 24 bits as an 8-bit logarithmic counter plus a 16-bit decay time (\`lfu-log-factor\`, \`lfu-decay-time\`).

**The hot-key problem:** consistent hashing spreads keys, not load. One celebrity key gets 50K reads/s on one shard. Answers: an L1 in-process LRU in front (each pod absorbs its own reads), key replication (\`key#1..key#8\` with random read suffix), or Redis client-side caching with invalidation (RESP3 \`CLIENT TRACKING\`).

**Memcached** does per-slab-class LRU (segmented into hot, warm and cold since 1.5) and evicts within the slab class of the incoming item's size. That is another case of local, approximate LRU being the practical choice.`,
      diagram: `  Distributed cache: local LRU per shard, no global order

             hash(key) on a ring with virtual nodes
                 .-- n1#a --.
          n3#b  /             \\  n2#a
               |    ring       |        key "user:42" -> n2
          n1#b  \\             /  n3#a
                 '-- n2#b --'

  +-----------+   +-----------+   +-----------+
  | node n1   |   | node n2   |   | node n3   |
  | LRU (own) |   | LRU (own) |   | LRU (own) |    each evicts locally
  +-----------+   +-----------+   +-----------+

  Redis eviction on one node (no list):
  sample 5 keys -> compare 24-bit LRU clocks -> merge into 16-slot pool -> evict oldest`,
      keyPoints: [
        'Exact global LRU means a global write per read: impractical and unnecessary.',
        'Consistent hashing gives local LRU per shard and moves ~1/N keys on resize.',
        'Redis: 24-bit clock per key + sampling (maxmemory-samples, default 5) + eviction pool; LFU reuses the bits.',
      ],
      source: 'Redis docs — Key eviction / Approximated LRU algorithm',
    },
  ],
  codeChallenges: [
    {
      id: 'lld-lru-cache-cc-1',
      title: 'Make this LRU thread-safe without a global lock',
      context:
        'A Java pricing service caches 200K computed fare quotes in the class below. It was written as "lock-free because every field is a concurrent collection". Under a 32-thread load test the map holds 200K entries but the deque holds 340K, p99 for get() is 40 ms, and recently read keys are sometimes evicted first. A single synchronized wrapper fixed correctness but capped throughput at about 1.1M ops/s with heavy contention.',
      task:
        'Make the cache correct under concurrent get/put and keep throughput scaling with cores, without one lock around the whole cache. State what you give up.',
      starter: {
        language: 'java',
        code: `import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;

public class NaiveConcurrentLru<K, V> {
    private final int capacity;
    private final ConcurrentHashMap<K, V> map = new ConcurrentHashMap<>();
    private final ConcurrentLinkedDeque<K> order = new ConcurrentLinkedDeque<>();

    public NaiveConcurrentLru(int capacity) { this.capacity = capacity; }

    public V get(K key) {
        V v = map.get(key);
        if (v != null) {
            order.remove(key);   // O(n) scan of the deque
            order.addFirst(key); // another thread may have re-added key in between
        }
        return v;
    }

    public void put(K key, V value) {
        if (map.put(key, value) != null) order.remove(key);
        order.addFirst(key);
        if (map.size() > capacity) {          // check-then-act across two structures
            K eldest = order.pollLast();
            if (eldest != null) map.remove(eldest);
        }
    }
}`,
      },
      hints: [
        'Each collection is thread-safe on its own. Which operations must happen together atomically, and what happens when two threads interleave between them?',
        'A get() changes the recency order. Can a read lock, or no lock, ever be enough for the ordering structure?',
        'ConcurrentHashMap itself scales by not having one lock. Could you partition the cache by key hash so that each partition is a small, ordinary LRU with its own lock?',
      ],
      solution: {
        language: 'java',
        code: `import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;

/** N independent LRU segments, each guarded by its own lock (lock striping). */
public final class StripedLruCache<K, V> {
    private static final class Segment<K, V> {
        final ReentrantLock lock = new ReentrantLock();
        final LinkedHashMap<K, V> map;
        Segment(final int cap) {
            // accessOrder = true: get() moves the entry to the MRU end (O(1), no scan)
            this.map = new LinkedHashMap<K, V>(16, 0.75f, true) {
                @Override protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
                    return size() > cap; // eviction happens inside put, under the same lock
                }
            };
        }
    }

    private final Segment<K, V>[] segments;
    private final int mask;

    @SuppressWarnings("unchecked")
    public StripedLruCache(int capacity, int concurrency) {
        int n = 1;
        while (n < concurrency) n <<= 1;                 // power of two
        segments = (Segment<K, V>[]) new Segment[n];
        for (int i = 0; i < n; i++) segments[i] = new Segment<>(Math.max(1, capacity / n));
        mask = n - 1;
    }

    private Segment<K, V> segmentFor(Object key) {
        int h = key.hashCode();
        h ^= (h >>> 16);                                 // spread high bits before masking
        return segments[h & mask];
    }

    public V get(K key) {
        Segment<K, V> s = segmentFor(key);
        s.lock.lock();                                   // reads lock too: get() reorders
        try { return s.map.get(key); } finally { s.lock.unlock(); }
    }

    public void put(K key, V value) {
        Segment<K, V> s = segmentFor(key);
        s.lock.lock();
        try { s.map.put(key, value); } finally { s.lock.unlock(); }
    }

    public V remove(K key) {
        Segment<K, V> s = segmentFor(key);
        s.lock.lock();
        try { return s.map.remove(key); } finally { s.lock.unlock(); }
    }

    /** Approximate under concurrency: segments are summed one at a time. */
    public int size() {
        int total = 0;
        for (Segment<K, V> s : segments) {
            s.lock.lock();
            try { total += s.map.size(); } finally { s.lock.unlock(); }
        }
        return total;
    }
}
// new StripedLruCache<String, Quote>(200_000, 64): 64 segments of 3,125 entries each`,
      },
      explanation: `**Why the starter is broken:**
- **No atomicity across the two structures.** Two threads calling \`get(k)\` can each \`remove\` and then each \`addFirst\`, leaving \`k\` in the deque twice. Later \`pollLast\` evicts a key that is still in use, and the deque grows past the map (340K vs 200K).
- **O(n) work per read.** \`ConcurrentLinkedDeque.remove(Object)\` walks the deque, so at 200K entries every get scans on average 100K nodes. That is where the 40 ms p99 comes from.
- **Check-then-act on size.** Several threads see \`size() > capacity\` and each evicts, or none does.

**The fix: lock striping.**
- Partition by key hash into N segments. Each segment is a plain \`LinkedHashMap\` in access order with \`removeEldestEntry\`: an ordinary single-threaded LRU with O(1) operations, guarded by its own \`ReentrantLock\`. All operations on a segment, including reads (which reorder), happen under that lock, so each segment is linearizable.
- Threads touching different segments never contend. With 64 segments and a decent hash, the chance that two threads collide is small, so throughput scales with cores. ConcurrentHashMap in Java 7 scaled the same way.
- Power-of-two segment count plus bit spreading gives a cheap, even distribution.

**What you give up (say it out loud):**
- **Global LRU becomes approximate.** Each segment evicts its own least-recently-used entry, which may be younger than the global LRU entry in another segment. With uniform hashing the difference in hit ratio is usually negligible.
- **Capacity is per segment.** A skewed key distribution can fill one segment and evict hot keys there while others have room. Use enough segments (≥ 4× cores) and a well-spread hash.
- **size() is a sum of snapshots**, not an atomic total.

**Production answer:** use Caffeine. It records reads in striped lock-free buffers and applies them to the policy in batches under \`tryLock\`, so reads never block, and it uses W-TinyLFU for a better hit ratio.`,
      followUps: [
        {
          q: 'Add getOrCompute(key, loader) where the loader takes 50 ms (a DB call). What goes wrong if you call it under the segment lock?',
          a: 'The segment lock is held for 50 ms, so every other key that hashes to that segment (1/64 of all traffic) blocks behind one slow load. Throughput for that segment drops to about 20 loads/s. Instead, keep a `ConcurrentHashMap<K, CompletableFuture<V>>` of in-flight loads. Under the lock, check the segment, and on a miss `putIfAbsent` a future and release the lock. Complete the future outside the lock, then insert the value under the lock. Concurrent callers for the same key join the future, so there is one load per key and other keys are never blocked.',
        },
        {
          q: 'How would you test this for thread safety, given that a passing unit test proves almost nothing?',
          a: 'Run a stress test: 32 threads × 1M random get/put over a key space about 3× the capacity. Afterwards assert the invariants: each segment size ≤ its cap, total size ≤ capacity, and every key returned by get maps to a value some thread actually put for it. Run it repeatedly and on a many-core machine. For memory-model level guarantees use jcstress, which runs small concurrent actors millions of times and reports forbidden outcomes. Also benchmark with JMH at 1, 8 and 32 threads to confirm the scaling claim.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-cc-2',
      title: 'Turn this "frequency cache" into a real O(1) LFU',
      context:
        'A recommendations service caches per-user feature vectors and the team wanted LFU so heavy users stay cached. The implementation below passed code review. In production, eviction CPU shows up in flame graphs at 50K entries, updating a user\'s vector sometimes evicts a different hot user, and among equally-used entries it evicts whichever was inserted first, even if it was read a second ago.',
      task:
        'Rewrite it as an LFU with O(1) get and put: evict the least frequently used key, break ties by least recently used, treat an update as a use, and never evict when updating an existing key.',
      starter: {
        language: 'typescript',
        code: `export class FrequencyCache<K, V> {
  private readonly map = new Map<K, { value: V; hits: number }>();

  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    e.hits++;
    return e.value;
  }

  put(key: K, value: V): void {
    if (this.map.size >= this.capacity) {
      let victim: K | undefined;
      let min = Infinity;
      for (const [k, e] of this.map) {       // O(n) scan on every eviction
        if (e.hits < min) { min = e.hits; victim = k; }
      }
      this.map.delete(victim!);
    }
    this.map.set(key, { value, hits: 0 });   // resets hits for existing keys too
  }
}`,
      },
      hints: [
        'List what the starter does on put() for a key that already exists. Count the bugs before you count the complexity.',
        'Among entries with the same count, which one does the scan pick? Is that insertion order or recency?',
        'Group entries by frequency. If each frequency had its own recency-ordered list, and you always knew the smallest non-empty frequency, which entry is the victim? When can that smallest frequency change?',
      ],
      solution: {
        language: 'typescript',
        code: `class LNode<K, V> {
  prev: LNode<K, V> | null = null;
  next: LNode<K, V> | null = null;
  freq = 1;
  constructor(public key: K, public value: V) {}
}

class DList<K, V> {
  readonly head = new LNode<K, V>(null as unknown as K, null as unknown as V);
  readonly tail = new LNode<K, V>(null as unknown as K, null as unknown as V);
  size = 0;
  constructor() { this.head.next = this.tail; this.tail.prev = this.head; }
  pushFront(n: LNode<K, V>): void {
    n.prev = this.head; n.next = this.head.next;
    this.head.next!.prev = n; this.head.next = n; this.size++;
  }
  remove(n: LNode<K, V>): void {
    n.prev!.next = n.next; n.next!.prev = n.prev; n.prev = n.next = null; this.size--;
  }
  popBack(): LNode<K, V> { const n = this.tail.prev!; this.remove(n); return n; }
}

export class LFUCache<K, V> {
  private readonly nodes = new Map<K, LNode<K, V>>();
  private readonly buckets = new Map<number, DList<K, V>>(); // freq -> recency-ordered list
  private minFreq = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError('capacity must be a positive integer');
  }

  get(key: K): V | undefined {
    const n = this.nodes.get(key);
    if (!n) return undefined;
    this.touch(n);
    return n.value;
  }

  put(key: K, value: V): void {
    const n = this.nodes.get(key);
    if (n) { n.value = value; this.touch(n); return; } // update = use; never evicts
    if (this.nodes.size === this.capacity) {
      const bucket = this.buckets.get(this.minFreq)!;
      const victim = bucket.popBack();                   // least frequent, then least recent
      if (bucket.size === 0) this.buckets.delete(this.minFreq);
      this.nodes.delete(victim.key);
    }
    const fresh = new LNode(key, value);
    this.nodes.set(key, fresh);
    this.bucket(1).pushFront(fresh);
    this.minFreq = 1;                                    // a new key is always the least frequent
  }

  private touch(n: LNode<K, V>): void {
    const old = this.buckets.get(n.freq)!;
    old.remove(n);
    if (old.size === 0) {
      this.buckets.delete(n.freq);                       // keep the bucket map small
      if (this.minFreq === n.freq) this.minFreq++;       // n moved to freq + 1, so that is the new min
    }
    n.freq++;
    this.bucket(n.freq).pushFront(n);
  }

  private bucket(f: number): DList<K, V> {
    let b = this.buckets.get(f);
    if (!b) { b = new DList<K, V>(); this.buckets.set(f, b); }
    return b;
  }
}
// LeetCode 460 sequence (cap 2): put1 put2 get1 put3 -> evicts 2; get3 put4 -> evicts 1`,
      },
      explanation: `**Bugs in the starter:**
- **Updating an existing key evicts someone else.** The size check runs before checking whether the key exists, so with a full cache, updating user A evicts the coldest user B for no reason.
- **Updates reset the frequency to 0.** The heaviest user becomes the coldest the moment their vector is refreshed. An update should count as a use.
- **Wrong tie-break.** The scan keeps the first entry with the minimum count, in Map insertion order. Ties are broken by "oldest inserted", not "least recently used", and because \`set\` on an existing key keeps its position, recency is never tracked at all.
- **O(n) eviction.** At 50K entries, every insert into a full cache walks 50K entries. That is the flame-graph hotspot.

**The O(1) design:**
- \`nodes\` maps key → node (value, freq). \`buckets\` maps freq → a doubly linked list ordered by recency within that frequency. \`minFreq\` points at the bucket to evict from.
- \`touch\` moves a node from bucket f to the front of bucket f+1. \`minFreq\` changes only if bucket f became empty *and* f was the minimum, and then it becomes exactly f+1.
- Insert evicts the tail of the \`minFreq\` bucket (least frequent, then least recent), then adds the new node at freq 1 and resets \`minFreq\` to 1.
- Every step is a hash lookup or a constant number of pointer writes. Empty buckets are deleted, so memory stays proportional to the number of entries.

**Verified** against the LeetCode 460 sequence and a randomized comparison with an O(n) reference model that tracks (freq, last-access tick).`,
      followUps: [
        {
          q: 'A user who was hot last month has freq 90,000 and will never be evicted, even though they churned. How do you fix LFU\'s memory of the past?',
          a: 'Add aging. Every T operations (say 10 × capacity), halve every node\'s frequency. A lazy version stores an epoch on each node and halves its count by the number of epochs missed when it is next touched, which keeps the work O(1) per operation. Buckets must be rebuilt or handled lazily, which is fiddly. The production answer is W-TinyLFU: frequency lives in a count-min sketch that is halved periodically, and the main region is SLRU, so old popularity fades automatically.',
        },
        {
          q: 'How does memory per entry compare to your LRU, and is the extra worth it?',
          a: 'Each node gains a `freq` field (8 bytes in V8), and the cache keeps one Map entry plus a DList with two sentinel nodes per distinct frequency, at roughly 100 bytes per bucket. With many distinct frequencies that adds up, but buckets are deleted when empty, so it is bounded by the number of entries and is usually far fewer. Overall it is about 10–15% more than LRU. It pays off only when popularity is stable and skewed. For shifting popularity, LRU or W-TinyLFU usually wins on hit ratio.',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'lld-lru-cache-iq-01',
      difficulty: 'medium',
      question:
        'Design and implement a cache with a fixed capacity that evicts the least recently used entry, with get and put both O(1). Before you write code, tell me what you need to clarify.',
      context: 'Opening rung of the ladder; 25–30 minutes including code.',
      whatInterviewerLooksFor: [
        'Clarifies count vs bytes, miss semantics, update-as-use, threading',
        'Justifies hash map + doubly linked list and rejects the alternatives with complexity',
        'Writes correct pointer code with sentinels; nodes carry their keys',
        'Tests ordering, update and eviction, and mentions model-based testing',
      ],
      modelAnswer: `**Clarifications (2 minutes):**
- Capacity in **entries or bytes**? (Assume entries for v1.)
- What does \`get\` return on a miss? (\`undefined\`, not \`-1\`, since \`-1\` can be a real value.)
- Does \`put\` on an existing key update the value **and** recency? (Yes.)
- Single-threaded? Any TTL? (Single-threaded, no TTL for v1. I will design so both can be added.)

**Design:**
- \`Map<K, Node>\` for O(1) lookup of the **node**.
- A doubly linked list ordered by recency, with **sentinel head and tail**: \`head.next\` is MRU and \`tail.prev\` is LRU.
- Nodes store \`key\`, \`value\`, \`prev\` and \`next\`. The key is needed because eviction starts from the tail node and must remove the entry from the map.

**Why not alternatives:** an array needs O(n) to move; timestamps need O(n) to find the minimum; a heap is O(log n) per get; a singly linked list cannot unlink in O(1) without the predecessor.

**Operations:**
- \`get\`: lookup → unlink → pushFront → return.
- \`put\` existing: set value → unlink → pushFront.
- \`put\` new: if full, \`victim = tail.prev\` → unlink → remove \`victim.key\` from the map; then create, \`map.set\`, pushFront.
- Primitives: \`unlink\` is two pointer writes; \`pushFront\` is four writes, reading \`head.next\` before overwriting it.

**Complexity:** O(1) average time per operation, O(capacity) space. The worst case is hash-collision bound.

**Tests:** capacity 2 classic sequence, an update moving a key to MRU without growing size, capacity 1, explicit removal. Then a randomized differential test against an O(n) array model, comparing the full key order after each operation.

**Production note:** in Node I would use \`lru-cache\`; in Java, \`LinkedHashMap(accessOrder=true)\` or Caffeine. Writing it by hand is about showing the structure.`,
      followUps: [
        {
          q: 'Why do you need sentinel nodes? Show me what the code looks like without them.',
          a: 'Without sentinels, `unlink` must handle four cases: node is the head (update `head`), node is the tail (update `tail`), node is the only element (both become null), or node is in the middle. `pushFront` must handle an empty list too. That is about six extra branches, and each one is a place to forget a pointer. With sentinels every real node always has non-null neighbours, so `unlink` is two writes and `pushFront` is four, with no branches. The cost is two extra node objects.',
        },
        {
          q: 'Your get() returns undefined on a miss. What if callers legitimately cache undefined, for example "user has no avatar"?',
          a: 'Then `undefined` is ambiguous. Options: expose `has(key)` (but has + get is two lookups and racy if an await sits between them), return a result object `{ hit: true, value }`, or store a sentinel value such as `NOT_FOUND` (negative caching) that the caller understands. Negative caching is valuable because it stops repeated DB lookups for absent keys. Give negative entries a shorter TTL so a newly created avatar shows up quickly.',
        },
      ],
      pitfalls: [
        'Forgetting to remove the victim\'s key from the map on eviction, or nodes that do not store keys',
        'pushFront writing head.next before reading it',
        'Using an array with indexOf/splice and calling it O(1)',
        'Not asking whether capacity means entries or bytes',
      ],
    },
    {
      id: 'lld-lru-cache-iq-02',
      difficulty: 'medium',
      question:
        'You used a hand-written list. Could you have just used JavaScript\'s Map, or Java\'s LinkedHashMap? Why or why not, and which would you ship?',
      whatInterviewerLooksFor: [
        'Explains Map insertion order and delete+set; LinkedHashMap accessOrder and removeEldestEntry',
        'Knows the set-on-existing-key position trap',
        'Explains why the hand-written list matters for later follow-ups',
        'Separates interview intent from production choice',
      ],
      modelAnswer: `**Yes, both work, and I would ship a library.**

**JavaScript Map:** a Map iterates in insertion order. V8 implements it as an ordered (deterministic) hash table, so:
- move to MRU = remove the key, then \`set(k, v)\`;
- LRU = \`map.keys().next().value\`;
- all amortised O(1).
**Trap:** \`map.set(existingKey, v)\` keeps the key's **original** position, so an update that does not remove the key first never refreshes recency. In V8 this version is often faster than hand-written nodes, because there are fewer objects and better locality.

**Java LinkedHashMap:** construct it with \`accessOrder = true\` so \`get\` moves entries to the end, and override \`removeEldestEntry\` to return \`size() > capacity\`. That is a complete LRU in about six lines. It is not thread-safe.

**Why I still hand-wrote it in this round:**
1. The question tests the data structure. Before choosing, I would ask: "Can I use the language's ordered map?" Both answers are fine, and asking shows judgement.
2. **The follow-ups need a real list.** O(1) LFU needs one ordered list per frequency, and SLRU or 2Q need two or three lists with moves between them. A budgeted TTL sweep walks from the cold end and stops early. Weighted eviction loops from the tail. A reusable \`DList\` abstraction makes each follow-up about 30 lines.

**What I would ship:**
- **Node:** \`lru-cache\`. It uses typed-array indices instead of node objects (lower GC pressure) and supports \`max\`, \`maxSize\` with \`sizeCalculation\`, \`ttl\`, \`dispose\`, and \`fetchMethod\` with in-flight de-duplication.
- **JVM:** Caffeine. It is concurrent, uses W-TinyLFU, and provides stats, a removal listener and a refresh-after-write loader. A \`LinkedHashMap\` only for single-threaded or small cases.

Hand-rolled caches in production code are a review smell unless there is a measured reason.`,
      followUps: [
        {
          q: 'You wrap LinkedHashMap(accessOrder=true) in a ReentrantReadWriteLock, with get under the read lock. What breaks?',
          a: 'With access order, `get` is a structural modification: it relinks the entry to the tail. Two readers holding the read lock simultaneously both relink and can corrupt the before/after pointers, which shows up as lost entries, infinite iteration or `ConcurrentModificationException`. In an access-ordered LRU every operation needs the exclusive lock, so use a plain lock or `synchronized`, or striping for scale. A read/write lock only helps for insertion-ordered maps where reads do not mutate.',
        },
        {
          q: 'What does lru-cache\'s fetchMethod give you that a plain get/set wrapper does not?',
          a: 'It de-duplicates concurrent fetches for the same key (one in-flight promise), supports stale-while-revalidate (`allowStale` returns the old value while refreshing), aborts a fetch with an AbortSignal when the key is removed or overwritten mid-flight so a stale load cannot publish, and passes context through `fetchContext`. Writing these correctly by hand is exactly the race-prone code that the async follow-up asks about.',
        },
      ],
      pitfalls: [
        'Calling map.set on an existing key to "refresh" it',
        'Claiming the Map version is slower (it usually is not in V8)',
        'Not asking the interviewer whether the library shortcut is allowed',
      ],
    },
    {
      id: 'lld-lru-cache-iq-03',
      difficulty: 'hard',
      question:
        'New requirement: entries vary from 200 bytes to 5 MB, and the cache must stay under 256 MB rather than N entries. Change your design.',
      whatInterviewerLooksFor: [
        'Introduces a weigher, stores the weight, and tracks a running total',
        'Evicts in a loop, rejects oversized entries, and handles updates that change weight',
        'Discusses how to estimate size in a managed runtime',
        'Considers that large entries dominate and may deserve separate treatment',
      ],
      modelAnswer: `**Changes to the core:**
- Constructor takes \`maxWeight\` (bytes) and a \`weigher(key, value) → number\`.
- Each node stores its \`weight\`, computed **once** at insert. Recomputing at eviction can drift if the value was mutated, and then \`totalWeight\` no longer balances.
- \`totalWeight\` is updated on insert, update (\`+= new − old\`), removal and eviction.

**put(k, v):**
1. \`w = weigh(k, v)\`. Validate that it is finite and ≥ 0.
2. If \`w > maxWeight\`: do not cache, remove any old version of \`k\` (so a stale value is not served), and return \`false\`.
3. Insert or update and move to MRU.
4. \`while (totalWeight > maxWeight) evict(tail.prev)\`. **A loop, not an if**: one 5 MB put may evict 25,000 small entries. The new entry is MRU, so it is evicted last.

**Estimating size in Node:** the true heap footprint is not exposed. Practical proxies:
- For strings, \`2 × length\` (UTF-16 worst case) plus about 100 bytes of entry overhead.
- For Buffers, \`byteLength\`.
- For objects, \`Buffer.byteLength(JSON.stringify(v))\` × a calibration factor (often 2–3×, measured once with a heap snapshot), or the serialized size if you store serialized blobs, which also makes sizing exact.

**Design consideration:** a few 5 MB entries can evict thousands of small hot ones. Options:
- Cap the per-entry size (e.g. 1% of budget = 2.5 MB) and send larger objects to a different tier (Redis, or a CDN for blobs).
- Use separate caches per size class (Memcached's slab idea).
- Weight-aware policies (GreedyDual-Size) that consider cost / size.
- Admission control with W-TinyLFU. Caffeine supports \`maximumWeight\` with a \`Weigher\` and applies it to the same policy.

**Testing:** assert \`totalWeight ≤ maxWeight\` after every operation in the differential test. The model tracks weights too.`,
      followUps: [
        {
          q: 'A value object is mutated after put (someone pushes 10K items into a cached array). What happens to your accounting?',
          a: 'The cache still believes the entry weighs what it did at insert, so real memory exceeds the budget while `totalWeight` looks fine. Defences: cache immutable values (freeze them, or store serialized bytes), re-weigh on explicit `put` only and document that mutation is forbidden, or store a deep copy. Serialized storage is the most robust because the weight is exact and mutation is impossible, at the cost of a deserialize on every hit.',
        },
        {
          q: 'Your eviction loop may evict thousands of entries in one put. Is that a latency problem?',
          a: 'Yes, potentially. Evicting 25K nodes with removal listeners can take several milliseconds on the request path. Mitigations: cap the per-entry size so the worst case is bounded, run the listeners asynchronously (queue the evicted entries and dispatch later), or evict down to a low-water mark (e.g. 90% of budget) in a background task while put only guarantees the hard limit. Caffeine performs maintenance on its executor for exactly this reason.',
        },
      ],
      pitfalls: [
        'Evicting a single entry and assuming the new one fits',
        'Accepting an entry larger than the whole budget (cache thrash to empty)',
        'Recomputing weight at eviction time',
      ],
    },
    {
      id: 'lld-lru-cache-iq-04',
      difficulty: 'hard',
      question:
        'Add per-entry TTL. A product price must never be served more than 60 seconds old, and the cache must not fill up with dead entries. Walk me through the design and its costs.',
      whatInterviewerLooksFor: [
        'Lazy expiry on read for correctness',
        'An active mechanism for memory, with bounded cost',
        'Rejects one-timer-per-key and explains why',
        'Clarifies sliding vs absolute TTL and uses an injectable clock',
      ],
      modelAnswer: `**Correctness: lazy expiry.** Each node stores \`expiresAt\`. On \`get\`, if \`expiresAt <= now\`, remove the node and return a miss. That alone guarantees we never serve a price older than 60 s, regardless of any background process.

**Memory: active expiry with bounded cost.** Lazily-expired entries that are never read stay until LRU eviction reaches them. If the cache is large and mostly idle, that is wasted memory. Options:
1. **Budgeted sweep from the LRU end** every second (e.g. at most 200 nodes). Cold entries drift to the tail where the sweep finds them, and hot entries are caught by reads. O(budget) per tick.
2. When the cache is full, **reclaim an expired entry before evicting a live one** (a small sweep first).
3. **Uniform TTL** (all prices 60 s): expiry order equals write order, so a second list ordered by write time gives exact O(1) expiry from its head.
4. **Mixed TTLs:** a min-heap (O(log n) per write) or a hierarchical timing wheel (O(1), used by Caffeine and Kafka).
5. **Redis** samples 20 keys with TTLs, 10 times per second, and repeats while more than 25% are expired: probabilistic and CPU-bounded.

**Not one setTimeout per key:** a million timers, closures pinning evicted values, and a stale timer removing a *newer* value written under the same key. If someone insists on timers, the callback must check that the node it captured is still the current node for the key.

**Semantics to settle:** absolute TTL (prices: the age of the data matters) vs sliding (sessions: idle time matters). \`put\` resets the TTL. Inject \`now()\` so tests can advance time deterministically.

**Jitter:** if 50K prices are loaded at boot with the same TTL, they all expire in the same second, causing a stampede. Add ±10% jitter to TTLs, or refresh ahead of expiry for hot keys.`,
      followUps: [
        {
          q: 'Pricing says "60 s max staleness" but the DB is down for 5 minutes. Serve stale or fail?',
          a: 'That is a business decision, so make it explicit. Implement soft and hard TTLs: within the soft TTL (60 s) serve normally; between soft and hard (say 10 min) serve stale only if a refresh fails, and mark the response as stale; beyond the hard TTL, fail. Checkout should probably refuse a price older than 60 s and re-quote, while a product listing page can show a slightly stale price with a "prices may vary" banner. lru-cache\'s `allowStale` and Caffeine\'s `refreshAfterWrite` express this.',
        },
        {
          q: 'How do you unit-test expiry without sleeping?',
          a: 'Inject a clock function (`now: () => number`) and keep a mutable `t` in the test. Put at t=0 with a 100 ms TTL, set t=99 and assert a hit, set t=100 and assert a miss and that the size dropped. For the sweep, create entries with staggered TTLs, advance time, call `sweep(budget)` directly, and assert the count removed and that the budget was respected. Keep timer start/stop out of the logic and test it separately with `unref` checks or fake timers.',
        },
      ],
      pitfalls: [
        'Relying only on a background sweeper (stale reads between sweeps)',
        'Per-key timers',
        'Same TTL for all keys loaded together (synchronized expiry)',
      ],
    },
    {
      id: 'lld-lru-cache-iq-05',
      difficulty: 'hard',
      question:
        'This cache now sits in a Java service with 64 request threads. Make it thread-safe. Start with the simplest correct answer, then tell me why you would not stop there.',
      whatInterviewerLooksFor: [
        'Recognises that get mutates, so a read lock is insufficient',
        'Gives the simple correct version (synchronized / one lock) and its limit',
        'Explains why ConcurrentHashMap + concurrent deque is not atomic',
        'Proposes striping or Caffeine-style buffering and states the trade-offs',
      ],
      modelAnswer: `**Key insight first:** in an LRU, \`get\` is a write. It relinks the node. So every operation needs exclusive access to the ordering structure. A \`ReadWriteLock\` with reads under the read lock is incorrect.

**Simplest correct version:** \`synchronized\` on \`get\`, \`put\` and \`remove\` (or one \`ReentrantLock\` with try/finally). Each operation is ~100–200 ns, so it is fine for moderate load. Its limit: under 64 threads, the lock's cache line bounces between cores, waiters park and unpark, and throughput plateaus around 1M ops/s regardless of core count. \`ReentrantLock\` adds \`tryLock\`, timeouts and fairness, not throughput.

**The tempting wrong answer:** \`ConcurrentHashMap\` + \`ConcurrentLinkedDeque\`. Each is thread-safe, but **compound operations across them are not atomic**. Two gets of the same key can both remove and re-add it, leaving duplicates in the deque. Eviction can poll a key that was just touched. \`deque.remove(Object)\` is O(n). Thread-safe parts do not compose into a thread-safe whole.

**Scalable versions:**
1. **Lock striping:** N = 4× cores segments (power of two), each an independent \`LinkedHashMap(accessOrder)\` LRU with its own lock, chosen by spread hash. Contention drops roughly N-fold. The trade-off is that LRU becomes **per segment**, which approximates global LRU well with uniform hashing.
2. **Caffeine's approach:** store data in a ConcurrentHashMap so reads are lock-free. Record each access in a **striped, lossy ring buffer**. When a buffer fills, one thread acquires the policy lock with \`tryLock\` and drains the buffered events into the LRU/W-TinyLFU structures. Readers never wait for the policy. Writes go through a bounded write buffer. Losing some read events under extreme load slightly degrades recency accuracy but never correctness.

**What I would ship:** Caffeine. In the interview I would code striping, because it shows the idea in 50 lines.`,
      followUps: [
        {
          q: 'With 16 segments, one segment receives 30% of traffic because keys are like "tenant:1:...". What went wrong and what do you do?',
          a: 'Either the hash is not spreading well (poor low bits in `hashCode` for these strings) or a few hot keys dominate traffic. Spread the bits first (`h ^ (h >>> 16)`, or a stronger mix such as the murmur3 finalizer) and check the per-segment key counts. If keys are evenly spread but a handful of keys carry the load, more segments do not help, because the problem is per-key load, not distribution. Check per-segment hit and contention metrics. For hot keys, lock-free reads (Caffeine) remove the read contention entirely.',
        },
        {
          q: 'Could you make get() lock-free while keeping exact LRU order?',
          a: 'Not practically. Exact order needs every access to update a shared sequence immediately, which means contending on a shared structure. Lock-free doubly linked list relinking is notoriously hard (multi-pointer CAS). Production designs relax the requirement: buffer accesses and apply them later (Caffeine), use CLOCK, where a get just sets a reference bit with a plain write and the eviction hand does the work, or sample (Redis). Each makes reads cheap by making the order approximate.',
        },
      ],
      pitfalls: [
        'ReadWriteLock with get under the read lock',
        'Claiming two concurrent collections make the LRU thread-safe',
        'Not stating that striping makes eviction approximate',
      ],
    },
    {
      id: 'lld-lru-cache-iq-06',
      difficulty: 'hard',
      question:
        'Back in Node: someone says "Node is single-threaded, so this LRU is automatically safe". Then they add getOrLoad(key) that awaits the database on a miss. What breaks, and how do you fix it?',
      whatInterviewerLooksFor: [
        'Synchronous get/put are atomic; awaits are where interleaving happens',
        'Identifies stampede (N loads for one key) and stale-publish races',
        'In-flight promise per key, publish guards on invalidation',
        'Notes the multi-pod limits (per-pod caches, invalidation broadcast)',
      ],
      modelAnswer: `**What is true:** a synchronous \`get\` or \`put\` runs to completion without interruption, so the pointer surgery in my LRU can never interleave. No lock is needed for that.

**What breaks with \`async getOrLoad\`:** the operation is now "check, **await**, insert", and other requests run during the await.
1. **Stampede:** a hot key expires and 500 concurrent requests all miss and all call the DB. That is 500 identical queries, possibly exhausting the connection pool, and the cache did nothing.
2. **Stale publish:** request A starts loading \`price:42\` (slow, 300 ms). Meanwhile the price changes and the writer calls \`invalidate('price:42')\`. A's load finishes and inserts the **old** price, which now lives until its TTL.
3. **Capacity overshoot** in hand-rolled variants that check size before the await and insert after it.

**Fixes:**
- Keep the LRU operations synchronous and put the async logic in a \`LoadingCache\` wrapper.
- Keep an \`inFlight: Map<key, Promise>\`. On a miss, return the existing promise if there is one. Otherwise start the load, store its promise **synchronously** before any await, and clear it in \`finally\`.
- **Publish guard:** when the load resolves, insert only if \`inFlight.get(key) === thisPromise\`. \`invalidate\` clears the in-flight entry, so a racing load loses its right to publish (lru-cache uses an AbortSignal for the same purpose).
- Failed loads are not cached (or are negative-cached briefly), and the in-flight entry is cleared so the next request retries.

**Across pods:** in-flight de-duplication is per process, so 20 pods can still issue 20 loads. That is usually fine. For very hot keys, add a short Redis lock or a request-coalescing tier. Invalidation must also reach every pod (Pub/Sub), with a short TTL as a safety net.`,
      followUps: [
        {
          q: 'The DB call for a key fails. 500 waiters are attached to the in-flight promise. What do they all get, and what happens next second?',
          a: 'All 500 receive the same rejection, because they share one promise. That is correct and cheap. `finally` clears the in-flight entry, so the next request starts a fresh load. Without backoff, a failing DB gets one load per key per request burst, so add a short negative cache for errors (e.g. 1–2 s) or a circuit breaker around the loader. If a stale value exists, serve it during the outage rather than failing (stale-if-error).',
        },
        {
          q: 'Why not use an async mutex per key instead of the in-flight promise map?',
          a: 'It works, but it is heavier and slower: each waiter acquires the mutex in turn, re-checks the cache, and only the first loads. That means N sequential lock handoffs, each a microtask hop, instead of N callers awaiting one promise. The promise map is the single-flight pattern: it is lock-free, needs no release on error paths, and the result fans out to all waiters at once. Use a mutex only when the critical section must perform several awaited steps exclusively.',
        },
      ],
      pitfalls: [
        'Assuming single-threaded means race-free across awaits',
        'Setting the in-flight entry after an await',
        'No guard against publishing a value loaded before an invalidation',
      ],
    },
    {
      id: 'lld-lru-cache-iq-07',
      difficulty: 'expert',
      question:
        'Product says heavy users should never be evicted by one-off visitors. Convert your LRU into an LFU with O(1) get and put. Explain how you avoid scanning for the minimum frequency.',
      whatInterviewerLooksFor: [
        'Frequency buckets, each a recency-ordered list, plus a minFreq pointer',
        'Correct minFreq maintenance (only two update points)',
        'Correct tie-breaking and update-as-use',
        'Knows LFU\'s weaknesses (no decay, new items disadvantaged) and the fixes',
      ],
      modelAnswer: `**Structures:**
- \`nodes: Map<K, Node>\`, where a node holds key, value and freq.
- \`buckets: Map<number, DList>\`, where each list holds nodes with that frequency, MRU at the front.
- \`minFreq: number\`.

**get(k) / update:** touch the node. Remove it from \`buckets[f]\` and push it to the front of \`buckets[f+1]\`. If \`buckets[f]\` is now empty: drop that bucket, and **if \`f === minFreq\`, set \`minFreq = f + 1\`**. That is safe because the node we moved now lives at \`f+1\`, so that bucket is non-empty.

**put(k, v) new:** if full, evict \`buckets[minFreq].tail.prev\`, which is the least frequent and, among those, the least recent. Remove its key from \`nodes\` and drop the bucket if it is empty. Then insert the new node at freq 1 and **set \`minFreq = 1\`**.

**Why no scan is ever needed:** \`minFreq\` changes in only two places: a touch that empties the min bucket (+1 exactly) and an insert (reset to 1). Eviction may empty the min bucket, but an insert follows immediately and resets \`minFreq\` to 1. Every operation is O(1): hash lookups and constant pointer writes.

**Correctness checks I would run:** the LeetCode 460 sequence, and a randomized comparison against an O(n) model that picks the victim by (freq ascending, last-access ascending).

**But pure LFU has problems I would raise:**
1. **No forgetting:** last month's viral item keeps freq 90K forever. Fix with periodic halving (aging) or windowed counts.
2. **Newcomer disadvantage:** a new item starts at 1 and is evicted before it can prove itself, so a burst of new trending items thrashes. Fix with a small LRU window in front (W-TinyLFU's 1% window).
3. **Frequency is lost on eviction:** a key bouncing in and out restarts at 1 each time. TinyLFU's sketch keeps frequency for non-resident keys.

So: I would implement this, and recommend W-TinyLFU (Caffeine) for production.`,
      followUps: [
        {
          q: 'Where exactly would a bug appear if you forgot to reset minFreq to 1 on insert?',
          a: 'Suppose minFreq is 3 and the cache is full. You evict from bucket 3 and insert a new key at freq 1 without resetting. On the next eviction you look at `buckets[3]`, which may now be empty or missing, so you either crash on undefined or evict a freq-3 node while the true least-frequent node (the new freq-1 key) survives. The randomized differential test catches this within a few hundred operations.',
        },
        {
          q: 'Can you get O(1) LFU without per-frequency lists, using something simpler?',
          a: 'Approximately, yes. Keep a frequency sketch (count-min, 4-bit counters) and an LRU or SLRU list. On eviction, compare the candidate\'s and the victim\'s estimated frequencies and keep the more frequent one (TinyLFU admission). That is O(1), uses less memory than buckets, ages naturally by halving counters, and remembers non-resident keys. The price is approximate counts (sketch collisions overestimate), which barely matters for admission decisions.',
        },
      ],
      pitfalls: [
        'Scanning for the minimum frequency on eviction',
        'Updating minFreq incorrectly (e.g. recomputing it, or never incrementing it)',
        'Resetting frequency on update',
        'Presenting pure LFU as strictly better than LRU',
      ],
    },
    {
      id: 'lld-lru-cache-iq-08',
      difficulty: 'expert',
      question:
        'Every night at 2 am a reconciliation job reads 3 million order records once each through the same service. By morning the L1 cache\'s hit ratio has fallen from 94% to 51% and takes two hours to recover. Neither LRU nor plain LFU is acceptable to the team. What policy do you implement, and how would you code it on top of what you have?',
      whatInterviewerLooksFor: [
        'Identifies the one-hit-wonder scan pattern and why LRU is defenceless',
        'Knows SLRU / 2Q / LRU-K / W-TinyLFU and their mechanisms',
        'Can implement SLRU on the existing DList in a few lines',
        'Also offers an architectural fix (bypass the cache for batch reads)',
      ],
      modelAnswer: `**Diagnosis:** each of the 3M records is read exactly once. Under LRU every such read becomes MRU and pushes a genuinely hot entry out, so by the end of the job the cache is full of records nobody will read again. Plain LFU would protect the hot set, but it never forgets and handles new trending items badly, which is why the team rejected it.

**Cheapest fix (do this anyway):** the job should not go through the serving cache. Give it a read path that bypasses L1 (a \`noCache\` option, or a separate service instance or replica). Policy is the second line of defence.

**Policy: Segmented LRU (SLRU), which I can code on my DList:**
- Two lists: **probation** (20% of capacity) and **protected** (80%).
- A new key enters **probation**'s front.
- A hit on a key in probation **promotes** it to protected's front. If protected exceeds its cap, its tail is **demoted** to probation's front (it gets a second chance rather than being evicted).
- A hit in protected moves it to protected's front.
- Eviction always takes **probation's tail**.
- The scan's 3M one-time keys enter and leave probation without ever touching protected, so the hot set survives. The extra code is about 30 lines: a segment flag on the node, two lists, two counters.

**Better: W-TinyLFU (Caffeine's policy).** A 1% window LRU in front of an SLRU main region. When the window evicts a candidate, it competes with the main region's victim on **count-min sketch frequency**, and the loser is dropped. Scan keys have a sketch frequency of about 1 and lose to any established victim. Counters are halved every ~10× capacity samples, so old popularity fades. Hit ratio is near optimal across many traces.

**Alternatives worth naming:** 2Q (an A1in FIFO plus an A1out ghost list), LRU-2 (rank by second-to-last access), and InnoDB-style midpoint insertion.

**Verification:** replay a production access log (an hour of keys) through LRU, SLRU and W-TinyLFU simulations offline and compare hit ratios before shipping. Policies should be chosen by trace, not by intuition.`,
      followUps: [
        {
          q: 'With SLRU, a genuinely new hot product launches at 9 am. Is it at a disadvantage?',
          a: 'Slightly. It starts in probation (20% of capacity), and a second hit promotes it. A product with real traffic gets its second hit within seconds, so it reaches protected almost immediately. The risk is a very small probation segment under heavy churn, where a new key is evicted before its second hit. Tune the probation size, or use W-TinyLFU, whose window LRU accepts everything first and whose adaptive variant (hill climbing in Caffeine) resizes the window based on the observed hit ratio.',
        },
        {
          q: 'How would you size the probation and protected segments without guessing?',
          a: 'Simulate. Record a sample of real access keys (e.g. one hour, hashed), and replay it through an SLRU simulator with probation at 5%, 10%, 20% and 40% of capacity. Plot the hit ratio and pick the knee. Re-run quarterly or when traffic patterns change. Caffeine automates this with hill climbing: it periodically adjusts the window/main split in the direction that improved the hit ratio over the last sample period.',
        },
      ],
      pitfalls: [
        'Doubling the cache size (only helps if the whole scan fits)',
        'Switching to pure LFU without decay',
        'Ignoring the simplest fix: keep batch reads out of the serving cache',
      ],
    },
    {
      id: 'lld-lru-cache-iq-09',
      difficulty: 'hard',
      question:
        'Three teams want your cache: one needs LRU, one FIFO for an audit buffer, and one wants to try W-TinyLFU later. They also want hit-ratio dashboards and to be told when entries are evicted. How do you structure the code?',
      whatInterviewerLooksFor: [
        'Strategy for eviction with a minimal hook interface',
        'Observer for removal events with causes, isolated listeners',
        'Correct stats semantics and export as counters',
        'Awareness of the abstraction cost and of where Caffeine fuses it',
      ],
      modelAnswer: `**Separate the three axes of change:**
1. **Storage and API** (\`get\`, \`set\`, \`remove\`, capacity): owned by \`Cache<K, V>\`.
2. **Who gets evicted:** an \`EvictionPolicy<K>\` Strategy with four hooks: \`onInsert\`, \`onAccess\`, \`onRemove\` and \`victim()\`. \`LruPolicy\` reorders on access; \`FifoPolicy\` ignores access; \`SlruPolicy\` and \`TinyLfuPolicy\` keep their own structures. A future W-TinyLFU also needs an **admission** hook (\`admit(candidate, victim): boolean\`), so I would design for that now as an optional method that defaults to "always admit".
3. **What happens around it:** stats counters and removal listeners (Observer).

**Removal events carry a cause:** \`SIZE\` (evicted), \`EXPIRED\`, \`EXPLICIT\` (removed by the caller), \`REPLACED\` (overwritten). Teams care about different causes: the audit team wants \`SIZE\` (data loss), while a write-back integration wants \`SIZE\` and \`EXPIRED\` for dirty entries. Listeners are isolated with try/catch, called **after** the cache state is consistent, and must not call back into the cache synchronously. For heavy listeners, dispatch through a queue.

**Stats done right:**
- Counters: hits, misses, loads, load failures, coalesced waiters, evictions by cause, and total load time.
- Expired-on-read counts as a **miss**.
- Export **counters** to Prometheus (\`cache_requests_total{cache, result}\`) and compute the ratio in PromQL over 5-minute windows. A since-boot ratio gauge cannot be aggregated across pods and hides new regressions.
- Keep the stats cheap: plain increments in Node; in Java, \`LongAdder\` (not \`AtomicLong\`) to avoid contention.

**Cost:** one extra method call per operation, and possibly a second hash lookup if the policy keys its own map by K. That is acceptable for a library at this scale. Caffeine avoids it by code-generating node classes per configuration, which is a performance detail rather than a design requirement.

**Configuration:** a builder (\`CacheBuilder.maximumSize(10_000).policy(new SlruPolicy(0.2)).recordStats().onRemoval(fn).build()\`) validates combinations, for example rejecting a weigher combined with a count capacity.`,
      followUps: [
        {
          q: 'A removal listener writes evicted entries to S3 and takes 80 ms. What happens to put() latency, and how do you fix it?',
          a: 'If listeners run synchronously inside put, every put that evicts pays 80 ms, and a weighted put that evicts 50 entries pays seconds. Run listeners asynchronously: push `(key, value, cause)` onto a bounded queue drained by a worker (Caffeine runs listeners on its executor). Decide the overflow policy: block, discard with a metric, or spill to disk. Since this listener persists data, discarding is unacceptable, so apply backpressure or move to write-through for that team.',
        },
        {
          q: 'Your dashboard shows a 97% hit ratio, yet DB load did not drop after the cache went live. Name two ways the stat could be lying.',
          a: 'First, expired entries found on read may be counted as hits before the expiry check, so stale reads look like hits even though the code reloads from the DB. Second, coalesced waiters may be counted as hits, or loads triggered outside `get` (refresh-ahead, explicit prefetch) may not be counted as misses or loads at all. Also check whether the ratio is a lifetime average dominated by a warm period. Compare `loads_total` against DB query metrics; they should match.',
        },
      ],
      pitfalls: [
        'Policy code that also manages storage and stats (no separation)',
        'Listeners that throw and leave the cache half-updated',
        'Exporting a pre-computed hit-ratio gauge',
      ],
    },
    {
      id: 'lld-lru-cache-iq-10',
      difficulty: 'expert',
      question:
        'A view-counter service increments counts in an in-process LRU and only writes to Postgres when an entry is evicted (write-back). Finance found that 0.3% of counts are missing. Find the bugs and fix the design.',
      whatInterviewerLooksFor: [
        'Crash and deploy loss of dirty entries',
        'Read-after-evict staleness and out-of-order flushes per key',
        'Flush error handling and shutdown flushing',
        'Proposes durable alternatives (WAL, Redis INCR, Kafka aggregation) where loss is unacceptable',
      ],
      modelAnswer: `**Where 0.3% goes missing:**
1. **Deploys and crashes.** Every rolling deploy kills pods holding dirty counts. Without a SIGTERM \`flushAll\`, or with flushing slower than the 30 s grace period, those increments vanish. This is usually the biggest source.
2. **Read-after-evict race.** Entry \`video:9\` (count 1,200, dirty) is evicted and its save is in flight. A new increment misses the cache and loads from Postgres, which still says 1,000. It increments to 1,001, and that value is later flushed, overwriting 1,200. **200 views lost.**
3. **Out-of-order flushes.** The same key is evicted twice in quick succession, and the older save lands after the newer one.
4. **Failed saves** that are logged and discarded.
5. **Absolute writes** (\`SET count = 1201\`) instead of deltas mean any race overwrites rather than adds.

**Fixes in the cache:**
- Keep evicted-but-unflushed values in a \`flushing\` map and serve reads from it until the save completes.
- Chain saves per key so they land in order.
- **Write deltas, not totals:** \`UPDATE counters SET views = views + $delta\`. A delta flush is commutative, so ordering and read-after-evict races stop losing counts. This is the most important change.
- Retry failed flushes with backoff, and re-insert the delta as dirty (bounded) or dead-letter it with an alert.
- On SIGTERM, stop accepting traffic (readiness false), \`flushAll\`, and exit. Also flush periodically (every 5 s) so a crash loses at most 5 s of increments.

**When 0.3%, or even 5 s of loss, is unacceptable:**
- Use Redis \`INCRBY\` as the counter of record, with AOF \`everysec\`, and sync to Postgres in batches.
- Or append a view event to Kafka (durable) and aggregate in a stream processor with exactly-once sinks.
- The in-process write-back cache is then just an aggregator of a few seconds of increments in front of a durable log.

**Interview framing:** a write-back cache trades durability for write throughput. Say the loss window out loud (a crash loses up to the flush interval) and get finance to accept it, or do not use one.`,
      followUps: [
        {
          q: 'With delta flushes, is the read-after-evict race still a problem for displayed counts?',
          a: 'Not for the stored total: a delta of +1 applied after the in-flight +200 still sums correctly in Postgres. The displayed count can briefly be low, since a reader may see 1,000 + local delta while the 200 is in flight. That is acceptable for view counts. If display accuracy matters, serve reads from `flushing` values plus local deltas, or read from Redis as the source of truth.',
        },
        {
          q: 'A pod is OOM-killed (SIGKILL), so no shutdown hook runs. What is the worst-case loss and how do you bound it?',
          a: 'Everything dirty since the last periodic flush, across all keys in that pod: at 2,000 increments/s per pod and a 5 s flush interval, up to about 10,000 views. Bound it with a shorter flush interval (1 s, at more DB write load, which delta batching keeps cheap), a memory limit that leaves headroom so OOM kills are rare, and a durable append (Redis INCR or a Kafka event) before acknowledging the view if the loss window must be zero.',
        },
      ],
      pitfalls: [
        'Flushing absolute totals instead of deltas',
        'No shutdown or periodic flush',
        'Reading from the DB while a newer value is still being flushed',
      ],
    },
    {
      id: 'lld-lru-cache-iq-11',
      difficulty: 'expert',
      question:
        'We now need the cache shared by 40 API pods and holding 300 GB. Can we keep exact LRU semantics across the cluster? If not, what do we give up, and how do Redis and Memcached handle eviction?',
      whatInterviewerLooksFor: [
        'Explains why exact global LRU is impractical (a write per read, coordination)',
        'Partitioning via consistent hashing; local LRU per shard',
        'Redis sampling with eviction pool and 24-bit clock; Memcached slab LRU',
        'Hot keys and the role of an L1 in front',
      ],
      modelAnswer: `**Exact global LRU is impractical.** It needs one global order updated on **every read**: at 500K reads/s that is 500K cross-node ordering writes per second through a single owner or a consensus log. The cache would be slower and less available than the database behind it. It is also unnecessary, because with uniform hashing each shard sees a representative sample of keys, so per-shard LRU closely tracks global LRU.

**Architecture:** a dedicated cache cluster (Redis Cluster or Memcached), not the API pods' heaps. 300 GB across ~12 shards of 25–32 GB, with replicas.
- **Partitioning:** Redis Cluster's 16,384 hash slots, or client-side consistent hashing with 100–200 virtual nodes per server (Memcached). Resizing moves about 1/N of the keys.
- **Eviction is local per shard.**

**Redis (one shard):** no linked list, because that would cost 16 bytes of pointers per key and pointer writes on every read. Each object has a **24-bit LRU clock** (second resolution). When memory exceeds \`maxmemory\`, Redis samples \`maxmemory-samples\` keys (default 5), puts candidates in a 16-entry **eviction pool** sorted by idle time, and evicts the best. With 10 samples it is nearly indistinguishable from true LRU. \`allkeys-lfu\` reuses the 24 bits as an 8-bit logarithmic counter plus a decay timestamp. Choose \`allkeys-*\` for a pure cache, since \`volatile-*\` ignores keys without a TTL.

**Memcached:** memory is divided into slab classes by item size. Each class has its own LRU, segmented into HOT/WARM/COLD since 1.5, which also gives scan resistance. Eviction happens in the class of the incoming item, so a size-skewed workload can evict hot small items while large-item classes sit idle. Slab rebalancing (\`slab_reassign\`, automove) mitigates this.

**What we give up:** exact global recency, cross-shard atomic operations, and (on resize) some hits. **Hot keys** are the real risk: one key's 50K reads/s land on one shard. Mitigate with a small in-process L1 LRU per pod (1–5 s TTL), key replication (\`k#1..k#8\`), or Redis client-side caching (\`CLIENT TRACKING\`) so reads stay local until invalidated.`,
      followUps: [
        {
          q: 'You add a 13th Redis shard during peak. What happens to hit ratio and DB load for the next few minutes?',
          a: 'Redis Cluster migrates hash slots, about 1/13 ≈ 7.7% of keys, to the new node. Keys are moved, not lost, so in theory the hit ratio holds. During migration, requests for keys in moving slots get `ASK` redirects (extra round trips), and a client with a stale slot map gets `MOVED`. With client-side consistent hashing in Memcached, those ~7.7% of keys simply miss and refill from the DB. Pre-warm the new node or add it off-peak, and rate-limit DB refill.',
        },
        {
          q: 'Why is Redis\'s sampled LRU good enough, and when would you raise maxmemory-samples?',
          a: 'With 5 samples plus the eviction pool, the evicted key is very likely among the oldest few percent, and since hit ratio depends on keeping the hot set, evicting "old" rather than "oldest" barely matters. Raise it to 10 when you can measure a hit-ratio gap versus a true-LRU simulation (for example on small or heavily skewed key spaces). It costs more CPU per eviction, which matters at high write and eviction rates. Measure `evicted_keys` and latency before and after.',
        },
      ],
      pitfalls: [
        'Proposing a global linked list or a global lock across nodes',
        'Running the 300 GB cache inside the API pods\' heaps',
        'Treating consistent hashing as a fix for hot keys',
      ],
    },
    {
      id: 'lld-lru-cache-iq-12',
      difficulty: 'hard',
      question:
        'You have a 90-minute machine-coding round: "Build an in-memory cache library with pluggable eviction, TTL, stats and thread safety." What do you build first, what do you stub, and how do you demo it?',
      context: 'Machine-coding format used by companies such as Flipkart, Razorpay, Swiggy and PhonePe.',
      whatInterviewerLooksFor: [
        'Time-boxed plan with a working core early',
        'Clean seams (policy, clock, listener, storage) so extras slot in',
        'Tests or a demo script that exercise edge cases',
        'Clear statement of concurrency approach and what is out of scope',
      ],
      modelAnswer: `**Minutes 0–10: requirements and API.** \`Cache<K, V>\` with \`get\`, \`put(k, v, ttlMs?)\`, \`remove\`, \`size\`, \`stats()\` and \`onRemoval(listener)\`. Capacity is in entries (weights are a stated extension). Eviction policies: LRU and LFU now, FIFO for free. Single process. I state which concurrency guarantees I will provide.

**Minutes 10–15: skeleton and seams.**
- \`DList\` + \`ListNode\` (reusable).
- \`EvictionPolicy<K>\` interface (\`onInsert\`, \`onAccess\`, \`onRemove\`, \`victim\`).
- \`Clock\` interface (\`now()\`) for TTL tests.
- \`RemovalListener\` with a \`RemovalCause\` enum.
- \`CacheBuilder\` that validates configuration.

**Minutes 15–45: working core.**
1. \`LruPolicy\` on DList: the full get/put/evict path working end to end. **Commit and demo point #1.**
2. TTL: \`expiresAt\` on the entry, lazy check in \`get\`, and \`sweep(budget)\` callable from the demo (the janitor timer is a stub).
3. Stats counters with expired-as-miss. Listeners with causes, isolated.

**Minutes 45–65: second policy.** \`LfuPolicy\` with frequency buckets + minFreq. Because of the Strategy seam, the cache class does not change.

**Minutes 65–80: concurrency and tests.** In Node, all cache methods are synchronous, so they are atomic. Add \`getOrLoad\` with in-flight de-duplication. Write a test file covering capacity 1, update-as-use, TTL boundaries with a fake clock, the LFU tie-break, a listener throwing, and a randomized differential test for LRU.

**Minutes 80–90: demo and talk.** A \`demo.ts\` script prints the eviction order for LRU vs LFU on the same sequence, shows a TTL expiry, and prints stats. Then I describe the next steps I did not build: weights, SLRU/W-TinyLFU, Java striping, write-back, and Redis for multi-pod.

**What I stub:** the janitor timer, persistence, metrics export (\`stats()\` returns an object) and the async listener queue.

**Evaluation criteria I optimise for:** it runs, the code is readable with small classes, extending it means adding a class rather than editing one, edge cases are tested, and I can explain the concurrency model.`,
      followUps: [
        {
          q: 'At minute 70 the interviewer says: "Add a policy that evicts the entry with the largest size first." How long does it take, and what changes?',
          a: 'About 10 minutes if the seams are right. Add a weight to entries via the builder\'s weigher, and implement `LargestFirstPolicy` with a max-heap on (weight, key) plus a lazy-removal set, or a sorted structure, giving O(log n) per operation, and say so. The cache class only needs to pass the weight in `onInsert`, which is a small interface change I would have anticipated with an `EntryMeta` argument. A test shows that a large entry is evicted before small ones.',
        },
        {
          q: 'You are at minute 80 and LFU has a bug you cannot find. What do you do?',
          a: 'Do not spend the last 10 minutes debugging silently. Disable LFU from the builder\'s options, make sure LRU, TTL and stats demo cleanly, and tell the interviewer exactly what fails, with the failing test and your hypothesis (likely minFreq maintenance on bucket removal). Evaluators weigh a working, well-structured core plus an honest diagnosis above two half-working features. Then explain how the differential test would localise it.',
        },
      ],
      pitfalls: [
        'Spending 40 minutes on design docs before any code runs',
        'A single class containing all policies in a switch',
        'No tests or demo for edge cases',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'lld-lru-cache-boe-1',
      question:
        'An inventory service keeps 2 million SKU availability records in a hand-written LRU in each Node pod. Each value is a small object { available, qty, updatedAt }. Estimate the heap per pod, how much of it is bookkeeping, and what a packed layout would save.',
      assumptions: [
        '64-bit V8 with pointer compression (4-byte tagged pointers)',
        'Key: 14-char string like "sku:1234567890" ≈ 32 bytes on the heap',
        'LRU node object (key, value, prev, next) ≈ 32 bytes',
        'Map entry in V8\'s ordered hash table ≈ 24 bytes amortised at typical load',
        'Value object with three fields ≈ 40 bytes (header + fields + boxed double for updatedAt)',
      ],
      steps: [
        { label: 'Per entry', calc: 'key 32 + node 32 + map slot 24 + value 40 ≈ 128 bytes' },
        { label: 'Total heap', calc: '2,000,000 × 128 B ≈ 256 MB' },
        { label: 'Bookkeeping share', calc: '(32 + 32 + 24) ÷ 128 ≈ 69% is not your data' },
        { label: 'Packed layout', calc: 'Map<key, index> (~24 B + key 32 B) + Uint32Array prev/next (8 B) + Int32Array qty (4 B) + Uint8Array flag (1 B) + Float64Array updatedAt (8 B) ≈ 77 B' },
        { label: 'Packed total', calc: '2,000,000 × 77 B ≈ 154 MB, about 40% less' },
        { label: 'GC effect', calc: 'Objects per entry drop from ~4 to ~1 (the key string), so 8M → 2M objects for the GC to trace' },
      ],
      answer:
        'About 256 MB per pod, roughly two-thirds of it bookkeeping. A typed-array index-based layout (the approach lru-cache takes) brings it to about 150 MB and cuts the number of GC-traced objects by about 4×.',
      insight:
        'For small values, per-entry overhead decides the capacity, not payload size. Count bytes per entry before choosing count-based capacity. Use packed layouts or an off-heap/external store when entries are tiny and numerous, and remember every pod pays this cost separately.',
      followUps: [
        {
          q: 'The team wants 20 million SKUs per pod instead. Does the in-process LRU still make sense?',
          a: 'At about 77–128 B per entry that is 1.5–2.5 GB of heap per pod. Above the default old-space limit you would need `--max-old-space-size`, full GCs get longer, and every pod pays it. It is better to keep a small L1 (the hottest 200K SKUs, about 25 MB) and put the full set in Redis. Redis spends about 70–90 B per small key including its own overhead, but once per cluster rather than once per pod, and it is not on your GC\'s critical path.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-boe-2',
      question:
        '40 API pods each run a 512 MB in-process LRU in front of Redis, for 60,000 product-read requests/s. Entries average 2 KB plus 120 bytes of overhead. Estimate L1 capacity, the load reaching Redis and Postgres, and the hidden cost of the L1 tier.',
      assumptions: [
        'L1 hit ratio 75% (the hot set does not fully fit), Redis hit ratio 97% on what reaches it',
        'Product writes: 500 updates/s, each must invalidate L1 on every pod',
        'Load balancer spreads requests uniformly, so every pod sees the same hot set',
      ],
      steps: [
        { label: 'Entries per pod', calc: '512 MB ÷ 2.12 KB ≈ 247,000 entries' },
        { label: 'Reads reaching Redis', calc: '60,000 × (1 − 0.75) = 15,000 req/s' },
        { label: 'Reads reaching Postgres', calc: '15,000 × (1 − 0.97) = 450 req/s' },
        { label: 'Total heap spent on L1', calc: '40 × 512 MB ≈ 20 GB' },
        { label: 'Unique data in L1', calc: 'At most ~247K distinct entries × 2.12 KB ≈ 0.5 GB → about 40× duplication' },
        { label: 'Invalidation fan-out', calc: '500 writes/s × 40 pods = 20,000 invalidation deliveries/s' },
      ],
      answer:
        'About 247K entries per pod. Redis sees about 15K req/s and Postgres about 450 req/s. The L1 tier costs about 20 GB of heap for about 0.5 GB of distinct data, plus about 20K invalidation messages per second.',
      insight:
        'An in-process LRU replicates data, it does not partition it, so its value is latency and shielding Redis from hot keys rather than capacity. Keep L1 small, hot and short-TTL. Spend memory on the shared tier, where each byte is stored once.',
      followUps: [
        {
          q: 'You halve L1 to 256 MB per pod and the L1 hit ratio drops from 75% to 68%. Is that a good trade?',
          a: 'Redis load rises from 15K to 60K × 0.32 = 19.2K req/s, a 28% increase that one or two Redis shards absorb easily. Postgres goes from 450 to about 576 req/s. In exchange you free about 10 GB of heap across the fleet and shorten GC pauses. If Redis has headroom and p99 targets are met, it is a good trade. Measure p99 latency and Redis CPU before and after, because hit ratio alone does not decide it.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-boe-3',
      question:
        'A JVM service on 32 cores must sustain 3 million cache operations per second against one access-ordered LRU. Estimate whether a single lock works and how many stripes you need.',
      assumptions: [
        'Critical section (hash lookup + relink) ≈ 150 ns when uncontended',
        'Under heavy contention, lock handoff (cache-line transfer, park/unpark) pushes the effective cost to ≈ 1 µs per operation',
        'Keys are well distributed by hash; target per-stripe utilisation ≤ 10%',
      ],
      steps: [
        { label: 'Single lock, best case', calc: '1 ÷ 150 ns ≈ 6.7M ops/s (only if never contended)' },
        { label: 'Single lock, contended', calc: '1 ÷ 1 µs ≈ 1M ops/s < 3M required → saturated, queues grow' },
        { label: 'Utilisation needed per stripe', calc: '3M ops/s × 150 ns = 0.45 lock-seconds per second in total' },
        { label: 'Stripes for ≤ 10% each', calc: '0.45 ÷ 0.10 ≈ 4.5 → at least 8; choose 64 (2 × cores) to absorb skew' },
        { label: 'Per-stripe load at 64', calc: '3M ÷ 64 ≈ 47K ops/s × 150 ns ≈ 0.7% utilisation → rarely contended' },
      ],
      answer:
        'A single lock tops out around 1M ops/s under contention, so it cannot reach 3M. With 64 stripes, each sees about 47K ops/s at under 1% utilisation, so contention effectively disappears (at the cost of per-stripe rather than global LRU).',
      insight:
        'Contended locks are limited by coherence traffic, not by the critical section\'s instructions. Striping divides that traffic. Caffeine goes further by taking reads off the lock entirely (buffered access recording), which is why it scales past what striping alone gives.',
      followUps: [
        {
          q: 'Traffic is Zipf-skewed: the top 10 keys take 30% of operations. What happens to your 64 stripes?',
          a: 'Those 10 keys land in at most 10 stripes, so a single stripe can see 3M × 30% ÷ 10 ≈ 90K ops/s or more if two hot keys collide. That is still about 1.4% utilisation each, which is fine, but the risk grows with the skew. Contention on hot keys is the case striping cannot fix, since every access to one key hits one stripe. Caffeine-style lossy read buffers or an immutable read-mostly snapshot for the top keys remove it.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'lld-lru-cache-mcq-01',
      difficulty: 'hard',
      question:
        'A candidate\'s LRU has this eviction branch. With capacity 2, they call put a, b, c, d, e and then get(\'a\'). What happens?',
      code: {
        language: 'typescript',
        code: `put(key: K, value: V): void {
  // ... existing-key branch omitted (correct)
  if (this.map.size === this.capacity) {
    const lru = this.tail.prev!;
    this.unlink(lru);           // unlink also sets lru.prev = lru.next = null
    this.map.delete(key);       // <- the line under review
  }
  const node = new Node(key, value);
  this.map.set(key, node);
  this.pushFront(node);
}`,
      },
      options: [
        'The first eviction leaves the map at capacity + 1, no later put evicts, map size reaches 5, and get(\'a\') throws a TypeError on a null prev pointer',
        'Works correctly: the new key is not yet in the map, so deleting it is harmless',
        'Every put evicts, so the map never exceeds 2 but the list grows without bound',
        'get(\'a\') returns undefined because a was unlinked, and the size stays at 2',
      ],
      correct: [0],
      explanation:
        'The evicted node\'s key (a) stays in the map, pointing at an unlinked node. After inserting c the map holds 3 entries, so the size === capacity check never fires again and the map grows without bound (running it gives size 5). get(\'a\') finds the stale node and calls unlink on it, which dereferences a null prev and throws. The "works correctly" option is the trap: deleting the new key is indeed a no-op, which is exactly why the bug is silent.',
      followUps: [
        {
          q: 'Which single test in a test suite would have caught this within seconds?',
          a: 'Any test that asserts `size <= capacity` after a sequence longer than capacity + 1 inserts, or the differential test that compares the full key order with a reference model after every operation. A plain "put 3 into capacity 2, check the first was evicted" passes, because `get(a)` would crash only when you read the evicted key. Asserting invariants after every step, not just final values, is what catches pointer and bookkeeping bugs.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-02',
      difficulty: 'hard',
      question:
        'An exchange-rate cache is built on a JS Map for its insertion order. Rates are refreshed every few seconds with the method below. After a week, hot currency pairs are being evicted while stale pairs survive. Why?',
      code: {
        language: 'typescript',
        code: `upsert(pair: string, rate: number): void {
  if (!this.map.has(pair) && this.map.size >= this.capacity) {
    this.map.delete(this.map.keys().next().value!); // evict the first (oldest) key
  }
  this.map.set(pair, rate); // refresh
}
get(pair: string) {
  const r = this.map.get(pair);
  if (r !== undefined) { this.map.delete(pair); this.map.set(pair, r); }
  return r;
}`,
      },
      options: [
        'Map iteration order is unspecified, so keys().next() returns an arbitrary key',
        'delete followed by set inside get is O(n), which slows eviction',
        'set() on an existing key keeps its original insertion position, so refreshed pairs stay near the front and are evicted first unless a get happens to move them',
        'The capacity check uses >= instead of >, so it evicts one entry too early',
      ],
      correct: [2],
      explanation:
        'Map preserves insertion order, and updating an existing key does not change its position. The refresh path never moves hot pairs to the end, so pairs inserted early stay at the front and get evicted once the cache is full, even though they are refreshed constantly. Iteration order is specified (insertion order). delete+set is amortised O(1). The >= check with the has() guard is correct for a cache at capacity.',
      followUps: [
        {
          q: 'Should a background refresh count as "use" for recency at all?',
          a: 'Usually not. Recency should reflect demand, and a refresher touching every key would make everything look hot, which defeats eviction. Refresh in place without moving the key (as here, deliberately), or refresh only keys that were read recently (refresh-ahead driven by reads, like Caffeine\'s `refreshAfterWrite`, which triggers on access). The bug in this code is that it also never moved keys on update from real writes, which should count as use.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-03',
      difficulty: 'expert',
      question:
        'A byte-budgeted LRU (maxWeight 10 MB) is full of 100 KB entries. What happens when a 2 MB value is inserted with this code?',
      code: {
        language: 'typescript',
        code: `put(key: string, value: Buffer): void {
  const w = value.byteLength;
  this.insertAtFront(key, value, w);   // totalWeight += w
  if (this.totalWeight > this.maxWeight) {
    this.evictLru();                   // removes ONE entry from the tail
  }
}`,
      },
      options: [
        'Exactly enough 100 KB entries are evicted for the 2 MB value to fit',
        'The insert is rejected because the cache is full',
        'The 2 MB value itself is evicted immediately because it exceeds the per-entry average',
        'One 100 KB entry is evicted and the cache stays about 1.9 MB over budget until later puts evict more',
      ],
      correct: [3],
      explanation:
        'The code evicts a single entry per put, so after inserting 2 MB into a full 10 MB cache it removes one 100 KB entry and stays about 1.9 MB over the budget. Each later 100 KB insert evicts only one entry too, so the overshoot never shrinks. Eviction must loop while totalWeight > maxWeight. The new entry is at the MRU end, so it is not the victim, and nothing in this code rejects entries.',
      followUps: [
        {
          q: 'You switch to a while loop. Someone then inserts a 15 MB value. What does your loop do, and what should it do?',
          a: 'The loop evicts every other entry and then evicts the 15 MB entry itself (it is the only one left and still over budget), so the net effect is an empty cache plus a wasted copy. Check the weight before inserting: if `w > maxWeight`, refuse the entry (return false), remove any older version of the key so a stale value is not served, and record an `oversized_rejected` metric. Often a per-entry cap (e.g. 1–5% of the budget) is wiser.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-04',
      difficulty: 'expert',
      question:
        'A Node service wraps its LRU (capacity 100, currently full) with write-through to Redis. 50 requests for 50 different new keys arrive in the same tick. What is the cache size after they all complete?',
      code: {
        language: 'typescript',
        code: `async put(key: string, value: Product): Promise<void> {
  if (!this.lru.has(key) && this.lru.size >= this.capacity) {
    this.lru.evictOldest();
  }
  await this.redis.set('p:' + key, JSON.stringify(value)); // write-through
  this.lru.set(key, value);
}`,
      },
      options: [
        '100: each request evicts one entry and inserts one entry',
        '149: only the first request sees size >= 100 and evicts; the other 49 see 99 and skip eviction before anyone inserts',
        '150: none of them evict because the await happens first',
        '50: each eviction removes all entries older than the new key',
      ],
      correct: [1],
      explanation:
        'The capacity check and the insert are separated by an await. Request 1 sees size 100 and evicts (size 99), then awaits Redis. Requests 2–50 run their synchronous prefix while size is still 99, so none of them evict. When all 50 Redis writes resolve, 50 inserts land on 99 entries, giving 149 (running this pattern confirms it). Single-threaded execution does not make a check-await-act sequence atomic.',
      followUps: [
        {
          q: 'Fix it without adding a mutex.',
          a: 'Make the cache mutation synchronous and do the I/O outside it. Insert into the LRU first (which evicts as needed, atomically, since there is no await), then `await redis.set`. If the Redis write fails, remove the key from the LRU, or mark it, so the cache does not hold a value Redis never received. Alternatively write Redis first and insert afterwards, but run the eviction check at insert time, inside the same synchronous block as the set.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-05',
      difficulty: 'medium',
      question:
        'An LRU records hits and misses as shown. Dashboards show a 98% hit ratio while the database still receives roughly 40% of read traffic. What is the most likely explanation?',
      code: {
        language: 'typescript',
        code: `get(key: string): V | undefined {
  const n = this.map.get(key);
  if (!n) { this.misses++; return undefined; }
  this.hits++;
  if (n.expiresAt <= this.now()) { this.removeNode(n); return undefined; }
  this.moveToFront(n);
  return n.value;
}`,
      },
      options: [
        'Expired entries are counted as hits before the expiry check, although the caller treats them as misses and goes to the database',
        'The map lookup is O(n) for string keys, so misses are under-counted',
        'moveToFront resets expiresAt, so entries never expire',
        'hits and misses are not atomic in Node, so concurrent increments are lost',
      ],
      correct: [0],
      explanation:
        'The hit counter increments before the TTL check, so every expired lookup is counted as a hit even though it returns undefined and triggers a DB load. With a short TTL and steady traffic, a large share of lookups can be expired-but-present. Map lookup is O(1). moveToFront does not touch expiry here. Node\'s single thread makes these increments safe.',
      followUps: [
        {
          q: 'After fixing it the true hit ratio is 60%. The TTL is 30 s. What do you check next?',
          a: 'Split misses by cause: expired-on-read versus absent (evicted or never loaded). If expired dominates, the TTL is the limiter. Consider a longer TTL with event-driven invalidation, or refresh-ahead for hot keys. If absent dominates, check size-eviction counts: a high rate means capacity is below the working set, so enlarge it or fix scan pollution. Also check the key space: unique-per-request keys (timestamps, session ids in the key) can never hit.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-06',
      difficulty: 'hard',
      question:
        'A Java team wraps new LinkedHashMap<>(16, 0.75f, true) in different ways. Select ALL designs that are thread-safe for concurrent get/put.',
      options: [
        'Collections.synchronizedMap(lhm), using only get and put',
        'A ReentrantReadWriteLock with get under the read lock and put under the write lock',
        'All get/put calls inside synchronized (lock) { ... } on one private final lock object',
        'Replacing it with ConcurrentHashMap and keeping access order in a separate ConcurrentLinkedDeque',
        'Striping: N LinkedHashMap segments chosen by key hash, each guarded by its own ReentrantLock for both get and put',
      ],
      correct: [0, 2, 4],
      explanation:
        'With accessOrder=true, get relinks entries, so it is a structural write. A synchronizedMap or a single private monitor serialises every call, and striping serialises every call within each segment, so all three are correct. A read lock lets two gets relink concurrently and corrupt the list. Two concurrent collections do not make the compound "move key to front" or "evict eldest" operations atomic.',
      followUps: [
        {
          q: 'With Collections.synchronizedMap, a metrics thread iterates over entrySet() to compute total size. What can go wrong?',
          a: 'Iteration is not covered by the wrapper\'s per-call locking. Another thread\'s get (which reorders) or put during iteration throws `ConcurrentModificationException`, or the iteration yields inconsistent results. The Javadoc requires manually synchronizing on the wrapper while iterating, which blocks every request for the duration. Better options: keep an `AtomicLong` total updated in put and remove, or take a snapshot under the lock and iterate the copy.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-07',
      difficulty: 'expert',
      question:
        'A cache combines ConcurrentHashMap<K,V> with ConcurrentLinkedDeque<K> for recency (remove key, then addFirst on every access). Select ALL problems that appear under concurrent load.',
      options: [
        'The same key can end up in the deque more than once',
        'deque.remove(key) scans the deque, making each access O(n)',
        'ConcurrentHashMap.get blocks while another thread is writing the same bin',
        'The map and the deque can disagree in size, so eviction may remove a key that was just read',
        'The deque throws ConcurrentModificationException when two threads call addFirst',
      ],
      correct: [0, 1, 3],
      explanation:
        'Two threads touching the same key can each remove it (one succeeds) and then each addFirst, leaving duplicates. Later pollLast may evict a key that is also at the front, or a key whose map entry was already replaced, so the two structures drift. ConcurrentLinkedDeque.remove(Object) is a linear scan. ConcurrentHashMap reads are non-blocking. Concurrent deques are designed for concurrent addFirst and never throw ConcurrentModificationException.',
      followUps: [
        {
          q: 'Is there a way to make CHM + a concurrent queue work, as some libraries do?',
          a: 'Yes, by giving up exact, synchronous ordering. Record accesses as events in a lossy concurrent buffer, and have one thread at a time (holding `tryLock`) apply them to a non-concurrent LRU structure that lives beside the CHM. Entries carry their own node pointers, so relinking is O(1), and the policy is always mutated under one lock. That is Caffeine\'s (and ConcurrentLinkedHashMap\'s) design: concurrent data, serialised policy, batched recency.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-08',
      difficulty: 'hard',
      question:
        'A session cache uses per-entry TTLs (1–60 minutes) and a capacity of 500K. Select ALL statements that are true about lazy expiry, active expiry and their combination.',
      options: [
        'Lazy expiry alone guarantees that no expired value is ever returned',
        'Lazy expiry alone can leave memory occupied by expired sessions that are never read again until LRU pressure removes them',
        'A sweep that walks at most N nodes from the LRU end each second reclaims cold expired entries without scanning the whole cache',
        'Active expiry alone, run every second, guarantees that no expired value is ever returned',
        'One setTimeout per entry is the most memory-efficient way to get exact expiry',
      ],
      correct: [0, 1, 2],
      explanation:
        'The read-time check is what guarantees correctness, while the cold-end sweep reclaims memory in bounded time, and the two complement each other. Without a read-time check, a sweeper running every second still leaves up to a one-second window (more if the budget is exhausted) in which expired entries are served. Per-entry timers cost a timer object and closure per entry, pin values in memory and can fire against a newer value under the same key.',
      followUps: [
        {
          q: 'Sessions use sliding expiration (each request extends the TTL by 30 minutes). Does the cold-end sweep still find expired entries efficiently?',
          a: 'Even better than with absolute TTLs. With sliding expiry, recency and expiry order coincide: the least recently used entry is also the one closest to expiring, so a sweep from the LRU end finds expired sessions first and can stop at the first non-expired node. You can stop early instead of using a fixed budget. With mixed absolute TTLs that guarantee does not hold, which is why the budget exists.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-09',
      difficulty: 'hard',
      question:
        'In an O(1) LFU with frequency buckets, minFreq is 2. The only key in bucket 2 is read and moves to bucket 3. Buckets 3 and 7 are non-empty. What should minFreq become?',
      options: [
        'It stays 2 until the next eviction recomputes it',
        'It must be recomputed by scanning the bucket map for the smallest non-empty frequency',
        '1, because minFreq is always reset after an access',
        '3, because the touched key now sits in bucket 3, which is guaranteed non-empty',
      ],
      correct: [3],
      explanation:
        'When a touch empties the bucket equal to minFreq, the new minimum is exactly minFreq + 1, because the touched node moved there. No other node can have a frequency between 2 and 3. A scan is never needed. minFreq resets to 1 only on inserting a new key. Leaving it at 2 would point eviction at an empty or missing bucket.',
      followUps: [
        {
          q: 'An eviction empties the minFreq bucket. Why don\'t you need to fix minFreq right there?',
          a: 'In put, eviction only happens to make room for a new key, and the new key is inserted at frequency 1 immediately afterwards, which sets minFreq = 1. The temporarily stale value is never read. If you also expose an explicit `evict()` or `remove(key)` that can empty the min bucket without an insert following, then you must handle it: track non-empty frequencies, or recompute lazily on the next eviction (an O(F) scan over distinct frequencies, not over entries).',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-10',
      difficulty: 'expert',
      question:
        'A news app switched its article cache from LRU to an O(1) LFU. Hit ratio was better for a week, then fell steadily, and editors notice that breaking stories load slowly while last month\'s viral article is always cached. What is the root cause and the best remedy?',
      options: [
        'The frequency buckets leak memory; delete empty buckets',
        'LFU is O(log n), so eviction slows down as the cache grows; switch back to LRU',
        'Frequencies never decay, so old popular items outrank new ones and new articles are evicted before they accumulate hits; add aging or move to W-TinyLFU',
        'Ties between equal frequencies are broken by insertion order; break them by key hash instead',
      ],
      correct: [2],
      explanation:
        'Classic LFU accumulates counts forever. Yesterday\'s winners keep huge frequencies, while a breaking story starts at 1 and is the first victim, so it is evicted before it can earn hits (newcomer starvation). Remedies: periodic halving (aging), windowed counts, or W-TinyLFU, whose window LRU admits new items and whose sketch decays. Empty buckets do not explain the trend, O(1) LFU is constant time, and tie-breaking does not change which item wins at very different frequencies.',
      followUps: [
        {
          q: 'How does W-TinyLFU handle a breaking story that gets 5,000 reads in its first minute?',
          a: 'It enters the 1% window LRU immediately, so it is cached from the first read. Its sketch count climbs quickly (capped at 15 by 4-bit counters). When it is pushed out of the window, it duels the main region\'s victim, whose count after recent halvings is likely low, and wins admission. Old viral articles also lose their advantage because all counters are halved every ~10 × capacity samples.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-11',
      difficulty: 'hard',
      question:
        'A search service\'s product cache uses Segmented LRU (probation 20%, protected 80%). A crawler reads 5 million distinct product pages once each. What happens to the protected segment?',
      options: [
        'It is flushed, because each crawled page becomes most recently used',
        'It is untouched: crawled pages enter probation and are evicted from probation\'s tail without a second hit, so they never reach protected',
        'Half of it is demoted to make room for the crawl',
        'It grows to 100% of capacity because probation is bypassed during scans',
      ],
      correct: [1],
      explanation:
        'In SLRU, new keys enter probation, and only a second access promotes them to protected. A one-pass crawl generates no second hits, so crawled pages churn within the 20% probation segment and are evicted from its tail. Protected entries are demoted only when protected overflows, which requires promotions. The cost is that legitimately new hot items briefly live in probation too.',
      followUps: [
        {
          q: 'The crawler reads each page twice within a few seconds (HTML, then a JSON variant using the same cache key). Does SLRU still protect you?',
          a: 'No. The second read promotes each crawled page into protected, and the crawl now flushes the hot set through demotions. Options: give the crawler a separate cache key or a bypass flag, use a frequency-based admission filter (W-TinyLFU), whose sketch sees each page only twice versus hot items\' hundreds of hits, or require promotion only after a minimum time gap between accesses, as InnoDB\'s `innodb_old_blocks_time` does.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-12',
      difficulty: 'expert',
      question:
        'In W-TinyLFU, a candidate C leaves the window LRU while the main region is full. The count-min sketch estimates freq(C) = 1 and freq(V) = 6, where V is the main region\'s eviction victim. What happens, and why does this protect against scans?',
      options: [
        'C is discarded and V stays; one-hit wonders from a scan cannot displace established entries, because the sketch remembers V\'s history',
        'C replaces V, because the newest item always wins admission',
        'Both are kept and the cache temporarily exceeds capacity',
        'V is moved to the window and C to the main region, swapping roles',
      ],
      correct: [0],
      explanation:
        'TinyLFU admission compares estimated frequencies, and the higher one survives. A scan key\'s estimate is about 1, so it loses to any victim with a history, which keeps the main region full of proven entries. Because the sketch counts accesses for keys that are not resident, a key that keeps coming back does gain admission later. Capacity is never exceeded, and admission is a duel, not a swap.',
      followUps: [
        {
          q: 'An attacker spams a cache key to inflate its sketch frequency and pin junk in your cache. How do sketch-based caches defend against this?',
          a: 'Counters are capped (4 bits, maximum 15) and halved periodically, so inflation saturates quickly and decays. Caffeine also adds jitter to the admission decision (a small random chance to admit a moderately warm candidate) to counter HashDoS-style attacks on the sketch. Beyond that, rate-limit per client and avoid letting user-controlled input create unbounded distinct cache keys, which is the bigger risk.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-13',
      difficulty: 'hard',
      question:
        'Why does Redis implement allkeys-lru by sampling rather than by maintaining a doubly linked list over all keys?',
      options: [
        'Redis is single-threaded, and linked lists require locks',
        'Linked lists cannot be persisted to RDB snapshots',
        'A list costs two pointers (16 bytes) per key plus a pointer relink on every read; sampling needs only a 24-bit clock already inside each object and does work only when evicting',
        'Sampling gives exactly the same eviction order as a list, but is simpler to code',
      ],
      correct: [2],
      explanation:
        'With hundreds of millions of keys, 16 extra bytes per key is gigabytes, and relinking on every GET adds cost to the hottest path. Redis stores a 24-bit access clock in the object header and, on eviction, samples maxmemory-samples keys into a 16-entry eviction pool, getting close to true LRU at a fraction of the cost. Single-threading actually makes a list easy (no locks). Persistence is unrelated. Sampling is an approximation, not identical.',
      followUps: [
        {
          q: 'The same 24 bits serve allkeys-lfu. How can 24 bits hold a useful frequency?',
          a: 'Redis splits them: 16 bits store the last decrement time in minutes, and 8 bits store a logarithmic counter. The counter increments probabilistically (likelihood about 1 / ((counter − 5) × lfu-log-factor + 1)), so 255 can represent millions of hits. It decays by one for every `lfu-decay-time` minutes (default 1) since the last decrement. Eviction samples keys and removes the lowest counter, which is approximate LFU with aging, in the same memory.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-14',
      difficulty: 'hard',
      question:
        'A Memcached-style cache tier uses client-side consistent hashing over 8 nodes, each running its own LRU. You add a 9th node during business hours. Roughly what fraction of keys now map to a different node, and what is the immediate effect?',
      options: [
        'About 89%, as with modulo hashing, so the hit ratio collapses',
        'About 50%, because each old node gives half its keys to the new node',
        '0%, because consistent hashing never moves existing keys',
        'About 1/9 ≈ 11%; those keys miss and are reloaded from the database, so DB load briefly rises',
      ],
      correct: [3],
      explanation:
        'With consistent hashing (and enough virtual nodes), a new node takes over roughly 1/N of the ring, about 11% of keys for 9 nodes. Without migration those keys miss on their new owner, so the database briefly sees the refill. Modulo hashing would remap about 8/9 of keys. Some keys must move, or the new node would never receive any. Each old node gives up only about 1/9 of its keys, not half.',
      followUps: [
        {
          q: 'How do you avoid the DB spike from that 11% refill?',
          a: 'Add the node off-peak, or warm it by having clients dual-read for a short period (on a miss at the new owner, read the old owner before going to the DB and copy the value forward). Rate-limit loads with request coalescing per key, and keep a per-pod L1 in front so the hottest keys are shielded. With Redis Cluster, slots are migrated with their data, which avoids the refill entirely.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-15',
      difficulty: 'medium',
      question:
        'An interviewer asks why your LRU uses sentinel head and tail nodes. Which answer best captures the benefit?',
      options: [
        'They make eviction O(1) instead of O(n)',
        'Every real node always has non-null neighbours, so unlink and insert need no special cases for empty lists, single elements, or removing the first or last node',
        'They let the garbage collector reclaim evicted nodes faster',
        'They store the capacity and size so the map does not need to',
      ],
      correct: [1],
      explanation:
        'Sentinels remove edge cases from pointer code: unlink is always two writes and pushFront is always four, with no branching on null. Eviction is O(1) because of the tail pointer and the map, with or without sentinels. Sentinels have no effect on GC and do not hold size or capacity.',
      followUps: [
        {
          q: 'Can you implement the LRU with a single sentinel instead of two?',
          a: 'Yes. Use a circular doubly linked list with one dummy node. `dummy.next` is MRU and `dummy.prev` is LRU, and an empty list is `dummy.next === dummy`. It saves one node and keeps the same branch-free unlink and pushFront. The Linux kernel\'s `list_head` works this way. The two-sentinel version is easier to explain on a whiteboard, which is why it is the usual interview choice.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-16',
      difficulty: 'expert',
      question:
        'A Node heap snapshot shows a 1-million-entry LRU of small numeric values using about 180 MB, while the values themselves total about 8 MB. Which change reduces memory the most while keeping O(1) operations?',
      options: [
        'Store prev/next as indices in Uint32Array, values in a Float64Array, and keep only a Map from key to slot index',
        'Switch from a hand-written list to the Map insertion-order trick, removing the node objects',
        'Increase --max-old-space-size so the GC runs less often',
        'Replace string keys with Symbols, which are smaller',
      ],
      correct: [0],
      explanation:
        'The overhead is in per-entry objects (node, boxed value, pointers), not in the data. A struct-of-arrays layout with typed arrays reduces each entry to a few fixed-size slots plus the key-to-index map, and removes millions of objects the GC has to trace. lru-cache uses this design. The Map trick removes the node objects too, but still stores boxed or heap values and keeps more per-entry overhead. A larger heap does not shrink anything. Symbols are still heap objects and break key equality across lookups.',
      followUps: [
        {
          q: 'With an index-based layout, how do you handle removing an entry in the middle without leaving holes forever?',
          a: 'Keep a free list of slot indices. Push the slot onto it on removal or eviction, and pop from it on insert before taking a fresh slot. Relinking uses the prev/next index arrays exactly as pointers do, so unlink is still O(1). Capacity is preallocated (the arrays are sized to `max`), so there is no compaction and no GC churn, which is another reason the design suits fixed-capacity caches.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-17',
      difficulty: 'expert',
      question:
        'You implement a write-back LRU where dirty entries are saved to Postgres when evicted. Select ALL behaviours the implementation needs to avoid losing or corrupting data.',
      options: [
        'Serve reads for a key from its in-flight flush value until the save completes, instead of loading from Postgres',
        'Chain flushes per key so an older value cannot be written after a newer one',
        'Flush dirty entries on SIGTERM (and periodically) rather than only on eviction',
        'Skip flushing entries evicted by TTL, since expired data is stale anyway',
        'Never let a value loaded from Postgres overwrite a newer dirty value written during the load',
      ],
      correct: [0, 1, 2, 4],
      explanation:
        'Read-through during a flush otherwise returns the pre-flush value from Postgres. Without per-key ordering, two saves of the same key can land in the wrong order. Without shutdown and periodic flushes, deploys lose every dirty entry. A load racing with a set must not clobber the newer write. TTL expiry of a dirty entry still means un-persisted writes exist, so expired dirty entries must be flushed too, unless the business explicitly accepts dropping them.',
      followUps: [
        {
          q: 'Which single change makes most of these ordering races harmless for counters?',
          a: 'Flush deltas instead of absolute values: `UPDATE t SET n = n + $delta`. Addition is commutative and associative, so out-of-order saves, a read that saw the old total, and retries of non-applied deltas all converge to the right sum. Retries still need idempotency (a delta applied twice double-counts), so attach a flush id and record it in the same transaction. That is far simpler than strict ordering of absolute writes.',
        },
      ],
    },
    {
      id: 'lld-lru-cache-mcq-18',
      difficulty: 'medium',
      question:
        'A Node loading cache coalesces concurrent misses with an in-flight promise map. During a 300 ms load of price:42, an admin updates the price and calls invalidate(\'price:42\'), which clears the cached entry and the in-flight promise. What should happen when the original load resolves?',
      options: [
        'Insert the loaded value, since it is newer than nothing',
        'Re-run the load automatically and insert the second result',
        'Reject all waiting callers with an invalidation error',
        'Return the loaded value to its waiting callers but do not insert it, because the in-flight entry no longer matches this load\'s promise',
      ],
      correct: [3],
      explanation:
        'The load may have read the old price, so publishing it would cache stale data until TTL. Callers that were already waiting can still receive it (they asked before the update). The cache, however, must not adopt it, so the publish guard checks whether the in-flight entry still points at this promise. Rejecting the waiters punishes them for a race they did not cause. Automatic reloads add load and can still race.',
      followUps: [
        {
          q: 'The same invalidation must reach the in-process caches of all 30 pods. How, and what is the residual risk?',
          a: 'Publish the invalidation on a fan-out channel every pod subscribes to (Redis Pub/Sub, or a Kafka topic with a per-pod consumer group). Each pod calls the same `invalidate`, including its in-flight guard. Pub/Sub is fire-and-forget, so a pod that is disconnected or restarting misses messages. Bound the damage with a short TTL on L1 entries, and on reconnect flush or re-validate the L1, because you cannot know what was missed.',
        },
      ],
    },
  ],
};

export default topic;
