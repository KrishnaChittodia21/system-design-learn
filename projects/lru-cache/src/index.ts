// STARTER — implement every method. Run: npm run project -- lru-cache
// Rules: no relying on Map insertion order for recency — recency lives in YOUR doubly linked list.
// Use only erasable TypeScript (no enums / parameter properties / namespaces).

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
  // add private fields here (e.g. #head, #tail, #length)

  /** Number of nodes in the list. */
  get length(): number {
    throw new Error('Not implemented: DoublyLinkedList.length');
  }
  /** Front node (most recent), or null when empty. */
  get head(): ListNode<T> | null {
    throw new Error('Not implemented: DoublyLinkedList.head');
  }
  /** Back node (least recent), or null when empty. */
  get tail(): ListNode<T> | null {
    throw new Error('Not implemented: DoublyLinkedList.tail');
  }
  /** Insert a new node holding `value` at the front and return it. O(1). */
  pushFront(value: T): ListNode<T> {
    throw new Error('Not implemented: DoublyLinkedList.pushFront');
  }
  /** Unlink `node` (which must belong to this list) and clear its prev/next pointers. O(1). */
  remove(node: ListNode<T>): void {
    throw new Error('Not implemented: DoublyLinkedList.remove');
  }
  /** Move an existing node to the front. O(1). */
  moveToFront(node: ListNode<T>): void {
    throw new Error('Not implemented: DoublyLinkedList.moveToFront');
  }
  /** Remove and return the back node, or null when empty. O(1). */
  popBack(): ListNode<T> | null {
    throw new Error('Not implemented: DoublyLinkedList.popBack');
  }
  /** Values from front to back. O(n). */
  toArray(): T[] {
    throw new Error('Not implemented: DoublyLinkedList.toArray');
  }
}

export type EvictionReason = 'capacity' | 'expired';

export interface LRUCacheOptions<K, V> {
  /** Maximum number of entries (positive integer; otherwise throw RangeError). */
  capacity: number;
  /** Default time-to-live in ms for entries set without an explicit ttl. Omit for no expiry. */
  ttlMs?: number;
  /** Clock in ms. Defaults to Date.now. An entry is expired when now() >= setTime + ttl. */
  now?: () => number;
  /** Called when an entry leaves because of capacity or expiry (NOT on delete / clear / overwrite). */
  onEvict?: (key: K, value: V, reason: EvictionReason) => void;
}

export class LRUCache<K, V> {
  /** @throws RangeError when capacity is not a positive integer */
  constructor(options: LRUCacheOptions<K, V>) {
    throw new Error('Not implemented: LRUCache.constructor');
  }
  /** Number of stored entries (expired entries count until they are touched or pruned). */
  get size(): number {
    throw new Error('Not implemented: LRUCache.size');
  }
  get capacity(): number {
    throw new Error('Not implemented: LRUCache.capacity');
  }
  /** Return the value and mark the key most-recently-used. An expired entry is removed, reported as 'expired', and undefined returned. */
  get(key: K): V | undefined {
    throw new Error('Not implemented: LRUCache.get');
  }
  /** Return the value WITHOUT changing recency (expired → removed + undefined). */
  peek(key: K): V | undefined {
    throw new Error('Not implemented: LRUCache.peek');
  }
  /** True when a non-expired entry exists. Does not change recency. */
  has(key: K): boolean {
    throw new Error('Not implemented: LRUCache.has');
  }
  /** Insert or overwrite; the key becomes most-recently-used. `ttlMs` overrides the default TTL. Over capacity → evict the LRU entry ('capacity'). */
  set(key: K, value: V, ttlMs?: number): this {
    throw new Error('Not implemented: LRUCache.set');
  }
  /** Remove a key. Returns true if a live entry existed. No eviction callback. */
  delete(key: K): boolean {
    throw new Error('Not implemented: LRUCache.delete');
  }
  /** Remove everything (no callbacks). */
  clear(): void {
    throw new Error('Not implemented: LRUCache.clear');
  }
  /** Non-expired keys from most- to least-recently used. Does not change recency. */
  keys(): K[] {
    throw new Error('Not implemented: LRUCache.keys');
  }
  /** Remove every expired entry (reporting each as 'expired'); return how many were removed. */
  prune(): number {
    throw new Error('Not implemented: LRUCache.prune');
  }
}

export interface LFUCacheOptions<K, V> {
  capacity: number;
  onEvict?: (key: K, value: V) => void;
}

/**
 * STRETCH: O(1) LFU. Evict the least-frequently-used key; break ties by evicting the
 * least-recently-used among them. Hint: key → node, freq → DoublyLinkedList, plus minFreq.
 */
export class LFUCache<K, V> {
  constructor(options: LFUCacheOptions<K, V>) {
    throw new Error('Not implemented: LFUCache.constructor');
  }
  get size(): number {
    throw new Error('Not implemented: LFUCache.size');
  }
  /** Return the value and count one use. */
  get(key: K): V | undefined {
    throw new Error('Not implemented: LFUCache.get');
  }
  /** Return the value without counting a use. */
  peek(key: K): V | undefined {
    throw new Error('Not implemented: LFUCache.peek');
  }
  /** Use count of a key (a fresh set counts as 1), or undefined when absent. */
  frequency(key: K): number | undefined {
    throw new Error('Not implemented: LFUCache.frequency');
  }
  /** Insert with freq 1, or overwrite (counts as a use). When full, evict before inserting. */
  set(key: K, value: V): this {
    throw new Error('Not implemented: LFUCache.set');
  }
  delete(key: K): boolean {
    throw new Error('Not implemented: LFUCache.delete');
  }
}
