// Reference solution: consistent-hash ring with virtual nodes, weights and replica sets.

export type HashFn = (input: string) => number;

const encoder = new TextEncoder();

/** 32-bit FNV-1a over the UTF-8 bytes of `input`. Returns an unsigned 32-bit integer. */
export function fnv1a32(input: string, offsetBasis = 0x811c9dc5): number {
  let h = offsetBasis >>> 0;
  for (const byte of encoder.encode(input)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** MurmurHash3's finaliser: spreads every input bit across the output (avalanche). */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Seeded, well-mixed 32-bit hash: FNV-1a (seed folded into the offset basis) followed by fmix32.
 * Plain FNV-1a clusters badly on near-identical strings like "node-1#0", "node-1#1".
 */
export function hash32(input: string, seed = 0): number {
  return fmix32(fnv1a32(input, (0x811c9dc5 ^ Math.imul(seed, 0x9e3779b1)) >>> 0));
}

export interface HashRingOptions {
  /** virtual nodes per unit of weight (default 100) */
  vnodes?: number;
  /** hash for both vnode labels and keys (default: hash32 with seed 0) */
  hash?: HashFn;
}

interface Point {
  hash: number;
  node: string;
}

export class HashRing {
  #vnodes: number;
  #hash: HashFn;
  /** sorted by (hash, node) — the ring */
  #points: Point[] = [];
  #weights = new Map<string, number>();

  constructor(options: HashRingOptions = {}) {
    const v = options.vnodes ?? 100;
    if (!Number.isInteger(v) || v < 1) throw new RangeError('vnodes must be a positive integer');
    this.#vnodes = v;
    this.#hash = options.hash ?? ((s) => hash32(s));
  }

  /** Physical node ids, sorted. */
  get nodes(): string[] {
    return [...this.#weights.keys()].sort();
  }

  /** Total number of virtual-node points on the ring. */
  get pointCount(): number {
    return this.#points.length;
  }

  /** Place round(vnodes * weight) points labelled `${id}#${i}` on the ring. */
  addNode(id: string, weight = 1): void {
    if (this.#weights.has(id)) throw new Error(`node ${id} already exists`);
    if (!(weight > 0) || !Number.isFinite(weight)) throw new RangeError('weight must be > 0');
    const count = Math.max(1, Math.round(this.#vnodes * weight));
    this.#weights.set(id, weight);
    for (let i = 0; i < count; i++) this.#points.push({ hash: this.#hash(`${id}#${i}`) >>> 0, node: id });
    // Rebuilding by sort is O(P log P); fine because membership changes are rare vs lookups.
    this.#points.sort((a, b) => a.hash - b.hash || (a.node < b.node ? -1 : a.node > b.node ? 1 : 0));
  }

  /** Remove a node and all its points. Returns false if it was unknown. */
  removeNode(id: string): boolean {
    if (!this.#weights.delete(id)) return false;
    this.#points = this.#points.filter((p) => p.node !== id);
    return true;
  }

  /** Owner of `key`: the first point clockwise with hash >= hash(key), wrapping around. */
  getNode(key: string): string | undefined {
    if (this.#points.length === 0) return undefined;
    return this.#points[this.#successor(this.#hash(key) >>> 0)].node;
  }

  /** Up to `n` DISTINCT physical nodes, walking clockwise from the key (preference list). */
  getNodes(key: string, n: number): string[] {
    const out: string[] = [];
    const total = this.#weights.size;
    if (total === 0 || n <= 0) return out;
    const want = Math.min(n, total);
    const seen = new Set<string>();
    let i = this.#successor(this.#hash(key) >>> 0);
    for (let steps = 0; steps < this.#points.length && out.length < want; steps++) {
      const node = this.#points[i].node;
      if (!seen.has(node)) {
        seen.add(node);
        out.push(node);
      }
      i = (i + 1) % this.#points.length;
    }
    return out;
  }

  /** Index of the first point with hash >= h (binary search), wrapping to 0. */
  #successor(h: number): number {
    let lo = 0;
    let hi = this.#points.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.#points[mid].hash < h) lo = mid + 1;
      else hi = mid;
    }
    return lo === this.#points.length ? 0 : lo;
  }
}
