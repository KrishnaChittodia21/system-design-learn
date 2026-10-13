// Reference solution: Count-Min Sketch + heavy hitters (top-K) + "trending in the last N minutes".

/** MurmurHash3 x86 32-bit over the UTF-8 bytes of `key`. Unsigned result. */
export function murmur3_32(key: string, seed: number): number {
  const data = Buffer.from(key, 'utf8');
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let h = seed >>> 0;
  const nblocks = data.length >> 2;
  for (let i = 0; i < nblocks; i++) {
    let k = data.readUInt32LE(i * 4);
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  let k = 0;
  const tail = nblocks * 4;
  switch (data.length & 3) {
    case 3:
      k ^= data[tail + 2] << 16;
    // falls through
    case 2:
      k ^= data[tail + 1] << 8;
    // falls through
    case 1:
      k ^= data[tail];
      k = Math.imul(k, c1);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, c2);
      h ^= k;
  }
  h ^= data.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Count-Min dimensions for "estimate ≤ true + ε·N with probability ≥ 1 − δ":
 * width = ⌈e / ε⌉, depth = ⌈ln(1 / δ)⌉.
 */
export function sketchDimensions(epsilon: number, delta: number): { width: number; depth: number } {
  if (!(epsilon > 0 && epsilon < 1)) throw new Error('epsilon must be in (0, 1)');
  if (!(delta > 0 && delta < 1)) throw new Error('delta must be in (0, 1)');
  return { width: Math.ceil(Math.E / epsilon), depth: Math.ceil(Math.log(1 / delta)) };
}

export interface CountMinOptions {
  width: number;
  depth: number;
  /** row i hashes with murmur3_32(item, seed + i) (default seed 0) */
  seed?: number;
}

export class CountMinSketch {
  readonly width: number;
  readonly depth: number;
  readonly seed: number;
  #rows: Float64Array[];
  #total = 0;

  constructor(opts: CountMinOptions) {
    if (!Number.isInteger(opts.width) || opts.width < 1 || !Number.isInteger(opts.depth) || opts.depth < 1) {
      throw new Error('width and depth must be positive integers');
    }
    this.width = opts.width;
    this.depth = opts.depth;
    this.seed = opts.seed ?? 0;
    this.#rows = Array.from({ length: this.depth }, () => new Float64Array(this.width));
  }

  /** Sketch sized by sketchDimensions(epsilon, delta). */
  static fromError(epsilon: number, delta: number, seed = 0): CountMinSketch {
    return new CountMinSketch({ ...sketchDimensions(epsilon, delta), seed });
  }

  /** Sum of all counts added (N). */
  get total(): number {
    return this.#total;
  }

  #index(item: string, row: number): number {
    return murmur3_32(item, (this.seed + row) >>> 0) % this.width;
  }

  add(item: string, count = 1): void {
    if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
    for (let r = 0; r < this.depth; r++) this.#rows[r][this.#index(item, r)] += count;
    this.#total += count;
  }

  /** min over rows — never below the true count; above it by ≤ εN w.p. ≥ 1 − δ. */
  estimate(item: string): number {
    let best = Infinity;
    for (let r = 0; r < this.depth; r++) best = Math.min(best, this.#rows[r][this.#index(item, r)]);
    return best;
  }

  /** Cell-wise add `other` into this sketch. Requires identical width, depth and seed. */
  merge(other: CountMinSketch): void {
    if (other.width !== this.width || other.depth !== this.depth || other.seed !== this.seed) {
      throw new Error('cannot merge sketches with different width/depth/seed');
    }
    for (let r = 0; r < this.depth; r++) {
      const mine = this.#rows[r];
      const theirs = other.#rows[r];
      for (let c = 0; c < this.width; c++) mine[c] += theirs[c];
    }
    this.#total += other.#total;
  }

  clone(): CountMinSketch {
    const c = new CountMinSketch({ width: this.width, depth: this.depth, seed: this.seed });
    c.merge(this);
    return c;
  }
}

/** Binary min-heap with a custom comparator (negative = a comes first). */
export class MinHeap<T> {
  #h: T[] = [];
  #cmp: (a: T, b: T) => number;

  constructor(compare: (a: T, b: T) => number) {
    this.#cmp = compare;
  }

  get size(): number {
    return this.#h.length;
  }

  peek(): T | undefined {
    return this.#h[0];
  }

  push(x: T): void {
    this.#h.push(x);
    this.#up(this.#h.length - 1);
  }

  pop(): T | undefined {
    const h = this.#h;
    if (h.length === 0) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      this.#down(0);
    }
    return top;
  }

  /** Items in heap (array) order — not sorted. */
  toArray(): T[] {
    return [...this.#h];
  }

  #up(i: number): void {
    const h = this.#h;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.#cmp(h[i], h[p]) >= 0) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }

  #down(i: number): void {
    const h = this.#h;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && this.#cmp(h[l], h[m]) < 0) m = l;
      if (r < h.length && this.#cmp(h[r], h[m]) < 0) m = r;
      if (m === i) return;
      [h[i], h[m]] = [h[m], h[i]];
      i = m;
    }
  }
}

export interface Ranked {
  item: string;
  count: number;
}

/** Ranking order: count desc, then item asc. */
export function compareRanked(a: Ranked, b: Ranked): number {
  return b.count - a.count || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0);
}

export interface HeavyHittersOptions {
  k: number;
  /** used to build the sketch when `sketch` is not given (defaults ε = 0.001, δ = 0.01, seed 0) */
  epsilon?: number;
  delta?: number;
  seed?: number;
  sketch?: CountMinSketch;
}

/**
 * Streaming top-K: a Count-Min Sketch for counts + a size-K min-heap of candidates keyed by
 * estimated count. The heap's root is the weakest candidate; a newcomer replaces it only
 * if its estimate is larger.
 */
export class HeavyHitters {
  readonly k: number;
  readonly sketch: CountMinSketch;
  // Indexed min-heap so an existing candidate's count can be increased in O(log k).
  #heap: Ranked[] = [];
  #pos = new Map<string, number>();

  constructor(opts: HeavyHittersOptions) {
    if (!Number.isInteger(opts.k) || opts.k < 1) throw new Error('k must be a positive integer');
    this.k = opts.k;
    this.sketch = opts.sketch ?? CountMinSketch.fromError(opts.epsilon ?? 0.001, opts.delta ?? 0.01, opts.seed ?? 0);
  }

  add(item: string, count = 1): void {
    this.sketch.add(item, count);
    const est = this.sketch.estimate(item);
    const i = this.#pos.get(item);
    if (i !== undefined) {
      this.#heap[i].count = est;
      this.#down(i); // counts only grow → it can only move away from the root
      return;
    }
    if (this.#heap.length < this.k) {
      this.#heap.push({ item, count: est });
      this.#pos.set(item, this.#heap.length - 1);
      this.#up(this.#heap.length - 1);
      return;
    }
    const weakest = this.#heap[0];
    if (this.#weaker(weakest, { item, count: est })) {
      this.#pos.delete(weakest.item);
      this.#heap[0] = { item, count: est };
      this.#pos.set(item, 0);
      this.#down(0);
    }
  }

  estimate(item: string): number {
    return this.sketch.estimate(item);
  }

  /** Current candidates, best first (count desc, item asc). */
  top(): Ranked[] {
    return this.#heap.map((r) => ({ ...r })).sort(compareRanked);
  }

  /** a ranks below b (heap order: smaller count first; on ties the lexicographically larger item is weaker). */
  #weaker(a: Ranked, b: Ranked): boolean {
    return compareRanked(a, b) > 0;
  }

  #swap(i: number, j: number): void {
    const h = this.#heap;
    [h[i], h[j]] = [h[j], h[i]];
    this.#pos.set(h[i].item, i);
    this.#pos.set(h[j].item, j);
  }

  #up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.#weaker(this.#heap[i], this.#heap[p])) break;
      this.#swap(i, p);
      i = p;
    }
  }

  #down(i: number): void {
    const h = this.#heap;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && this.#weaker(h[l], h[m])) m = l;
      if (r < h.length && this.#weaker(h[r], h[m])) m = r;
      if (m === i) return;
      this.#swap(i, m);
      i = m;
    }
  }
}

export interface TrendingOptions {
  k: number;
  /** length of the sliding window, ms; must be a multiple of bucketMs */
  windowMs: number;
  /** granularity of time buckets, ms */
  bucketMs: number;
  epsilon?: number;
  delta?: number;
  seed?: number;
  now: () => number;
}

/**
 * "Trending in the last N minutes": a ring of time buckets, each with its own HeavyHitters
 * (sketch + candidates). Querying merges the live buckets' sketches (sketches are
 * mergeable because they share width/depth/seed) and ranks the union of their candidates.
 */
export class TrendingTopK {
  #opts: TrendingOptions;
  #buckets = new Map<number, HeavyHitters>();
  #span: number;

  constructor(opts: TrendingOptions) {
    if (!(opts.bucketMs > 0) || !(opts.windowMs > 0) || opts.windowMs % opts.bucketMs !== 0) {
      throw new Error('windowMs must be a positive multiple of bucketMs');
    }
    this.#opts = opts;
    this.#span = opts.windowMs / opts.bucketMs;
  }

  add(item: string, count = 1): void {
    const b = Math.floor(this.#opts.now() / this.#opts.bucketMs);
    this.#expire(b);
    let hh = this.#buckets.get(b);
    if (!hh) {
      hh = new HeavyHitters({ k: this.#opts.k, epsilon: this.#opts.epsilon, delta: this.#opts.delta, seed: this.#opts.seed });
      this.#buckets.set(b, hh);
    }
    hh.add(item, count);
  }

  /** Live buckets currently held (memory is bounded by windowMs / bucketMs). */
  bucketCount(): number {
    this.#expire(Math.floor(this.#opts.now() / this.#opts.bucketMs));
    return this.#buckets.size;
  }

  /** Estimated count of `item` over the window. */
  windowCount(item: string): number {
    return this.#merged()?.estimate(item) ?? 0;
  }

  /** Top-K over the window, best first. */
  top(): Ranked[] {
    const merged = this.#merged();
    if (!merged) return [];
    const candidates = new Set<string>();
    for (const hh of this.#buckets.values()) for (const r of hh.top()) candidates.add(r.item);
    return [...candidates]
      .map((item) => ({ item, count: merged.estimate(item) }))
      .sort(compareRanked)
      .slice(0, this.#opts.k);
  }

  #merged(): CountMinSketch | undefined {
    this.#expire(Math.floor(this.#opts.now() / this.#opts.bucketMs));
    let merged: CountMinSketch | undefined;
    for (const hh of this.#buckets.values()) {
      if (!merged) merged = hh.sketch.clone();
      else merged.merge(hh.sketch);
    }
    return merged;
  }

  /** Keep buckets b with current − span < b ≤ current. */
  #expire(current: number): void {
    for (const b of this.#buckets.keys()) if (b <= current - this.#span) this.#buckets.delete(b);
  }
}
