// Reference solution: O(1) LRU cache (hash map + hand-written doubly linked list),
// TTL with an injected clock, eviction callbacks, and an O(1) LFU cache.

/** A node in a doubly linked list. The cache keeps a reference to it in its hash map. */
export class ListNode<T> {
  value: T;
  prev: ListNode<T> | null = null;
  next: ListNode<T> | null = null;
  constructor(value: T) {
    this.value = value;
  }
}

/**
 * Doubly linked list with O(1) push-front, remove-by-node, move-to-front and pop-back.
 * "Front" = head = most recently used; "back" = tail = least recently used.
 */
export class DoublyLinkedList<T> {
  #head: ListNode<T> | null = null;
  #tail: ListNode<T> | null = null;
  #length = 0;

  get length(): number {
    return this.#length;
  }
  get head(): ListNode<T> | null {
    return this.#head;
  }
  get tail(): ListNode<T> | null {
    return this.#tail;
  }

  /** Insert a new node holding `value` at the front and return it. */
  pushFront(value: T): ListNode<T> {
    const node = new ListNode(value);
    this.#linkFront(node);
    return node;
  }

  /** Unlink `node` (which must belong to this list). */
  remove(node: ListNode<T>): void {
    if (node.prev) node.prev.next = node.next;
    else this.#head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.#tail = node.prev;
    node.prev = node.next = null;
    this.#length--;
  }

  /** Move an existing node to the front. */
  moveToFront(node: ListNode<T>): void {
    if (this.#head === node) return;
    this.remove(node);
    this.#linkFront(node);
  }

  /** Remove and return the back node, or null when empty. */
  popBack(): ListNode<T> | null {
    const node = this.#tail;
    if (node) this.remove(node);
    return node;
  }

  /** Values from front to back. */
  toArray(): T[] {
    const out: T[] = [];
    for (let n = this.#head; n; n = n.next) out.push(n.value);
    return out;
  }

  #linkFront(node: ListNode<T>): void {
    node.prev = null;
    node.next = this.#head;
    if (this.#head) this.#head.prev = node;
    this.#head = node;
    if (!this.#tail) this.#tail = node;
    this.#length++;
  }
}

export type EvictionReason = 'capacity' | 'expired';

export interface LRUCacheOptions<K, V> {
  /** Maximum number of entries (>= 1). */
  capacity: number;
  /** Default time-to-live in ms for entries set without an explicit ttl. Omit for no expiry. */
  ttlMs?: number;
  /** Clock in ms. Defaults to Date.now. */
  now?: () => number;
  /** Called when an entry leaves the cache because of capacity or expiry (not on delete/clear/overwrite). */
  onEvict?: (key: K, value: V, reason: EvictionReason) => void;
}

interface Entry<K, V> {
  key: K;
  value: V;
  /** absolute expiry time, or Infinity */
  expiresAt: number;
}

export class LRUCache<K, V> {
  #capacity: number;
  #ttlMs: number | undefined;
  #now: () => number;
  #onEvict: ((key: K, value: V, reason: EvictionReason) => void) | undefined;
  #map = new Map<K, ListNode<Entry<K, V>>>();
  #list = new DoublyLinkedList<Entry<K, V>>();

  constructor(options: LRUCacheOptions<K, V>) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1) {
      throw new RangeError('capacity must be a positive integer');
    }
    this.#capacity = options.capacity;
    this.#ttlMs = options.ttlMs;
    this.#now = options.now ?? Date.now;
    this.#onEvict = options.onEvict;
  }

  /** Number of stored entries (expired entries count until they are touched or pruned). */
  get size(): number {
    return this.#map.size;
  }

  get capacity(): number {
    return this.#capacity;
  }

  /** Return the value and mark the key most-recently-used. Expired entries are removed and reported. */
  get(key: K): V | undefined {
    const node = this.#live(key);
    if (!node) return undefined;
    this.#list.moveToFront(node);
    return node.value.value;
  }

  /** Return the value WITHOUT changing recency. */
  peek(key: K): V | undefined {
    return this.#live(key)?.value.value;
  }

  /** True when a non-expired entry exists. Does not change recency. */
  has(key: K): boolean {
    return this.#live(key) !== undefined;
  }

  /** Insert or overwrite; the key becomes most-recently-used. `ttlMs` overrides the default TTL. */
  set(key: K, value: V, ttlMs?: number): this {
    const ttl = ttlMs ?? this.#ttlMs;
    const expiresAt = ttl === undefined ? Infinity : this.#now() + ttl;
    const existing = this.#map.get(key);
    if (existing) {
      existing.value.value = value;
      existing.value.expiresAt = expiresAt;
      this.#list.moveToFront(existing);
      return this;
    }
    this.#map.set(key, this.#list.pushFront({ key, value, expiresAt }));
    if (this.#map.size > this.#capacity) {
      const lru = this.#list.popBack()!;
      this.#map.delete(lru.value.key);
      this.#onEvict?.(lru.value.key, lru.value.value, 'capacity');
    }
    return this;
  }

  /** Remove a key. Returns true if it existed (and was not expired). No eviction callback. */
  delete(key: K): boolean {
    const node = this.#live(key);
    if (!node) return false;
    this.#map.delete(key);
    this.#list.remove(node);
    return true;
  }

  clear(): void {
    this.#map.clear();
    this.#list = new DoublyLinkedList();
  }

  /** Non-expired keys from most- to least-recently used. Does not change recency. */
  keys(): K[] {
    const now = this.#now();
    const out: K[] = [];
    for (let n = this.#list.head; n; n = n.next) if (n.value.expiresAt > now) out.push(n.value.key);
    return out;
  }

  /** Remove every expired entry (reporting each as 'expired'); returns how many were removed. */
  prune(): number {
    const now = this.#now();
    let removed = 0;
    for (let n = this.#list.head; n; ) {
      const next = n.next;
      if (n.value.expiresAt <= now) {
        this.#expire(n);
        removed++;
      }
      n = next;
    }
    return removed;
  }

  #live(key: K): ListNode<Entry<K, V>> | undefined {
    const node = this.#map.get(key);
    if (!node) return undefined;
    if (node.value.expiresAt <= this.#now()) {
      this.#expire(node);
      return undefined;
    }
    return node;
  }

  #expire(node: ListNode<Entry<K, V>>): void {
    this.#map.delete(node.value.key);
    this.#list.remove(node);
    this.#onEvict?.(node.value.key, node.value.value, 'expired');
  }
}

export interface LFUCacheOptions<K, V> {
  capacity: number;
  onEvict?: (key: K, value: V) => void;
}

interface LfuEntry<K, V> {
  key: K;
  value: V;
  freq: number;
}

/**
 * O(1) LFU: key -> node, and freq -> list of nodes (front = most recent at that frequency).
 * Evict from the list at `minFreq`, taking its back (least recent) node to break ties.
 */
export class LFUCache<K, V> {
  #capacity: number;
  #onEvict: ((key: K, value: V) => void) | undefined;
  #nodes = new Map<K, ListNode<LfuEntry<K, V>>>();
  #buckets = new Map<number, DoublyLinkedList<LfuEntry<K, V>>>();
  #minFreq = 0;

  constructor(options: LFUCacheOptions<K, V>) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1) {
      throw new RangeError('capacity must be a positive integer');
    }
    this.#capacity = options.capacity;
    this.#onEvict = options.onEvict;
  }

  get size(): number {
    return this.#nodes.size;
  }

  /** Return the value and increment the key's use count. */
  get(key: K): V | undefined {
    const node = this.#nodes.get(key);
    if (!node) return undefined;
    this.#touch(node);
    return node.value.value;
  }

  /** Return the value without counting a use. */
  peek(key: K): V | undefined {
    return this.#nodes.get(key)?.value.value;
  }

  /** Use count of a key (a fresh set counts as 1), or undefined when absent. */
  frequency(key: K): number | undefined {
    return this.#nodes.get(key)?.value.freq;
  }

  /** Insert (freq 1) or overwrite (counts as a use). Evicts the least-frequent, least-recent key when full. */
  set(key: K, value: V): this {
    const existing = this.#nodes.get(key);
    if (existing) {
      existing.value.value = value;
      this.#touch(existing);
      return this;
    }
    if (this.#nodes.size >= this.#capacity) {
      const bucket = this.#buckets.get(this.#minFreq)!;
      const victim = bucket.popBack()!;
      if (bucket.length === 0) this.#buckets.delete(this.#minFreq);
      this.#nodes.delete(victim.value.key);
      this.#onEvict?.(victim.value.key, victim.value.value);
    }
    this.#nodes.set(key, this.#bucket(1).pushFront({ key, value, freq: 1 }));
    this.#minFreq = 1;
    return this;
  }

  delete(key: K): boolean {
    const node = this.#nodes.get(key);
    if (!node) return false;
    const bucket = this.#buckets.get(node.value.freq)!;
    bucket.remove(node);
    if (bucket.length === 0) {
      this.#buckets.delete(node.value.freq);
      // minFreq may now be stale; recompute lazily on next eviction is O(n), so fix here.
      if (this.#minFreq === node.value.freq) this.#minFreq = this.#smallestFreq();
    }
    this.#nodes.delete(key);
    return true;
  }

  #touch(node: ListNode<LfuEntry<K, V>>): void {
    const f = node.value.freq;
    const bucket = this.#buckets.get(f)!;
    bucket.remove(node);
    if (bucket.length === 0) {
      this.#buckets.delete(f);
      if (this.#minFreq === f) this.#minFreq = f + 1;
    }
    node.value.freq = f + 1;
    const next = this.#bucket(f + 1);
    // re-link the same node object so the map reference stays valid
    next.pushFront(node.value);
    const fresh = next.head!;
    this.#nodes.set(node.value.key, fresh);
  }

  #bucket(freq: number): DoublyLinkedList<LfuEntry<K, V>> {
    let b = this.#buckets.get(freq);
    if (!b) this.#buckets.set(freq, (b = new DoublyLinkedList()));
    return b;
  }

  /** Only used after delete empties the min bucket (rare); bounded by the number of distinct frequencies. */
  #smallestFreq(): number {
    let min = 0;
    for (const f of this.#buckets.keys()) if (min === 0 || f < min) min = f;
    return min;
  }
}
