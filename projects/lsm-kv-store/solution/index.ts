// Reference solution: a small LSM-tree key-value store.
//
//   put/delete ─► WAL (append) ─► memtable ──flush──► SSTable files (sorted, sparse index)
//                                                        │
//                                         size-tiered compaction (merge, drop shadowed/tombstones)
//
// All I/O is synchronous to keep the control flow obvious; every file lives under options.dir.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

/** A key and its value; `null` is a tombstone (the key was deleted). */
export type Entry = [key: string, value: string | null];

const MAGIC = 0x4c534d31; // "LSM1"
const FOOTER_BYTES = 16;

interface IndexBlock {
  /** first key of every `interval`-th record */
  keys: string[];
  /** byte offset of each of those records in the data section */
  offsets: number[];
  maxKey: string;
}

/**
 * Immutable sorted file.
 * Layout: [records...][index JSON][footer: indexOffset u32, indexLength u32, count u32, magic u32]
 * Record: keyLen u32 | valLen i32 (-1 = tombstone) | key utf8 | value utf8
 */
export class SSTable {
  readonly path: string;
  readonly count: number;
  /** number of entries in the in-memory sparse index */
  readonly indexEntries: number;
  /** bytes of the data section read by get/entries since open (not counting open itself) */
  bytesRead = 0;
  #index: IndexBlock;
  #dataEnd: number;
  #fd: number;

  private constructor(path: string, fd: number, index: IndexBlock, dataEnd: number, count: number) {
    this.path = path;
    this.#fd = fd;
    this.#index = index;
    this.#dataEnd = dataEnd;
    this.count = count;
    this.indexEntries = index.keys.length;
  }

  get minKey(): string | undefined {
    return this.#index.keys[0];
  }
  get maxKey(): string | undefined {
    return this.count ? this.#index.maxKey : undefined;
  }

  /** Write `entries` (sorted ascending, unique keys) to `path` and open it. */
  static write(path: string, entries: Entry[], indexInterval = 16): SSTable {
    const chunks: Buffer[] = [];
    const index: IndexBlock = { keys: [], offsets: [], maxKey: '' };
    let offset = 0;
    entries.forEach(([key, value], i) => {
      if (i > 0 && entries[i - 1][0] >= key) throw new Error('SSTable.write: entries must be sorted and unique');
      const k = Buffer.from(key, 'utf8');
      const v = value === null ? null : Buffer.from(value, 'utf8');
      const head = Buffer.alloc(8);
      head.writeUInt32LE(k.length, 0);
      head.writeInt32LE(v === null ? -1 : v.length, 4);
      if (i % indexInterval === 0) {
        index.keys.push(key);
        index.offsets.push(offset);
      }
      chunks.push(head, k);
      if (v) chunks.push(v);
      offset += 8 + k.length + (v?.length ?? 0);
      index.maxKey = key;
    });
    const indexBuf = Buffer.from(JSON.stringify(index), 'utf8');
    const footer = Buffer.alloc(FOOTER_BYTES);
    footer.writeUInt32LE(offset, 0);
    footer.writeUInt32LE(indexBuf.length, 4);
    footer.writeUInt32LE(entries.length, 8);
    footer.writeUInt32LE(MAGIC, 12);
    // write to a temp name then rename: a crash never leaves a half-written table under the real name
    writeFileSync(path + '.tmp', Buffer.concat([...chunks, indexBuf, footer]));
    renameSync(path + '.tmp', path);
    return SSTable.open(path);
  }

  /** Open an existing table, loading only the footer and sparse index into memory. */
  static open(path: string): SSTable {
    const fd = openSync(path, 'r');
    const size = statSync(path).size;
    const footer = Buffer.alloc(FOOTER_BYTES);
    readSync(fd, footer, 0, FOOTER_BYTES, size - FOOTER_BYTES);
    if (footer.readUInt32LE(12) !== MAGIC) {
      closeSync(fd);
      throw new Error(`${path}: bad magic`);
    }
    const indexOffset = footer.readUInt32LE(0);
    const indexLength = footer.readUInt32LE(4);
    const buf = Buffer.alloc(indexLength);
    readSync(fd, buf, 0, indexLength, indexOffset);
    return new SSTable(path, fd, JSON.parse(buf.toString('utf8')) as IndexBlock, indexOffset, footer.readUInt32LE(8));
  }

  /** undefined = key not in this table; null = tombstone; string = value. Reads at most one index block. */
  get(key: string): string | null | undefined {
    if (this.count === 0 || key < this.#index.keys[0] || key > this.#index.maxKey) return undefined;
    const b = this.#blockFor(key);
    for (const [k, v] of this.#readBlock(b)) {
      if (k === key) return v;
      if (k > key) return undefined;
    }
    return undefined;
  }

  /** Entries with start <= key < end (bounds optional), ascending. */
  entries(start?: string, end?: string): Entry[] {
    const out: Entry[] = [];
    if (this.count === 0) return out;
    let b = start === undefined ? 0 : this.#blockFor(start);
    for (; b < this.#index.keys.length; b++) {
      if (end !== undefined && this.#index.keys[b] >= end) break;
      for (const e of this.#readBlock(b)) {
        if (start !== undefined && e[0] < start) continue;
        if (end !== undefined && e[0] >= end) return out;
        out.push(e);
      }
    }
    return out;
  }

  close(): void {
    closeSync(this.#fd);
  }

  /** index of the last block whose first key <= key (0 if key precedes all). */
  #blockFor(key: string): number {
    const keys = this.#index.keys;
    let lo = 0;
    let hi = keys.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (keys[mid] <= key) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  #readBlock(b: number): Entry[] {
    const from = this.#index.offsets[b];
    const to = b + 1 < this.#index.offsets.length ? this.#index.offsets[b + 1] : this.#dataEnd;
    const buf = Buffer.alloc(to - from);
    readSync(this.#fd, buf, 0, buf.length, from);
    this.bytesRead += buf.length;
    const out: Entry[] = [];
    let p = 0;
    while (p < buf.length) {
      const kl = buf.readUInt32LE(p);
      const vl = buf.readInt32LE(p + 4);
      p += 8;
      const k = buf.toString('utf8', p, p + kl);
      p += kl;
      let v: string | null = null;
      if (vl >= 0) {
        v = buf.toString('utf8', p, p + vl);
        p += vl;
      }
      out.push([k, v]);
    }
    return out;
  }
}

export interface LsmOptions {
  /** directory that holds every file of this store (created if missing) */
  dir: string;
  /** flush the memtable once it holds this many keys (default 1000) */
  memtableMaxEntries?: number;
  /** sparse index granularity for new SSTables (default 16) */
  indexInterval?: number;
  /** size-tiered compaction: merge a tier once it has this many tables (default 4) */
  compactionThreshold?: number;
  /** run compaction automatically after each flush (default true) */
  autoCompact?: boolean;
}

export interface TableInfo {
  id: number;
  tier: number;
  count: number;
}

interface ManifestTable {
  id: number;
  tier: number;
}

interface Manifest {
  nextId: number;
  /** newest first */
  tables: ManifestTable[];
}

interface LiveTable extends ManifestTable {
  sst: SSTable;
}

export class LsmStore {
  #dir: string;
  #memMax: number;
  #indexInterval: number;
  #threshold: number;
  #autoCompact: boolean;
  #mem = new Map<string, string | null>();
  /** newest first */
  #tables: LiveTable[] = [];
  #nextId = 1;
  #closed = false;

  private constructor(o: LsmOptions) {
    this.#dir = o.dir;
    this.#memMax = o.memtableMaxEntries ?? 1000;
    this.#indexInterval = o.indexInterval ?? 16;
    this.#threshold = o.compactionThreshold ?? 4;
    this.#autoCompact = o.autoCompact ?? true;
  }

  /** Open (or create) a store: load the manifest + SSTables, delete orphan files, replay the WAL. */
  static open(options: LsmOptions): LsmStore {
    const s = new LsmStore(options);
    mkdirSync(s.#dir, { recursive: true });
    const manifestPath = join(s.#dir, 'MANIFEST');
    if (existsSync(manifestPath)) {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
      s.#nextId = m.nextId;
      s.#tables = m.tables.map((t) => ({ ...t, sst: SSTable.open(s.#tablePath(t.id)) }));
    }
    // a crash mid-flush/compaction can leave files the manifest never adopted
    const live = new Set(s.#tables.map((t) => `${t.id}.sst`));
    for (const f of readdirSync(s.#dir)) {
      if ((f.endsWith('.sst') && !live.has(f)) || f.endsWith('.tmp')) rmSync(join(s.#dir, f));
    }
    s.#replayWal();
    return s;
  }

  put(key: string, value: string): void {
    this.#write(key, value);
  }

  delete(key: string): void {
    this.#write(key, null);
  }

  get(key: string): string | undefined {
    this.#assertOpen();
    if (this.#mem.has(key)) return this.#mem.get(key) ?? undefined;
    for (const t of this.#tables) {
      const v = t.sst.get(key);
      if (v !== undefined) return v ?? undefined;
    }
    return undefined;
  }

  /** Live entries with start <= key < end, ascending; newest version wins, tombstones hidden. */
  scan(start?: string, end?: string): Array<[string, string]> {
    this.#assertOpen();
    const seen = new Map<string, string | null>();
    const inRange = (k: string) => (start === undefined || k >= start) && (end === undefined || k < end);
    for (const [k, v] of this.#mem) if (inRange(k)) seen.set(k, v);
    for (const t of this.#tables) for (const [k, v] of t.sst.entries(start, end)) if (!seen.has(k)) seen.set(k, v);
    return [...seen]
      .filter((e): e is [string, string] => e[1] !== null)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }

  /** Write the memtable as a new tier-0 SSTable, commit the manifest, then truncate the WAL. */
  flush(): void {
    this.#assertOpen();
    if (this.#mem.size === 0) return;
    const entries = [...this.#mem].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const id = this.#nextId++;
    const sst = SSTable.write(this.#tablePath(id), entries, this.#indexInterval);
    this.#tables.unshift({ id, tier: 0, sst });
    this.#saveManifest();
    writeFileSync(this.#walPath(), '');
    this.#mem.clear();
    if (this.#autoCompact) this.#maybeCompact();
  }

  /** Full compaction: merge every table into one, dropping shadowed versions and all tombstones. */
  compact(): void {
    this.#assertOpen();
    if (this.#tables.length === 0) return;
    const tier = Math.max(...this.#tables.map((t) => t.tier));
    this.#merge(0, this.#tables.length, tier);
  }

  /** Tables newest first. */
  tables(): TableInfo[] {
    return this.#tables.map((t) => ({ id: t.id, tier: t.tier, count: t.sst.count }));
  }

  /** Number of keys in the memtable (including tombstones). */
  get memtableSize(): number {
    return this.#mem.size;
  }

  /** Release file handles. Does NOT flush: unflushed writes stay in the WAL. */
  close(): void {
    if (this.#closed) return;
    for (const t of this.#tables) t.sst.close();
    this.#closed = true;
  }

  #write(key: string, value: string | null): void {
    this.#assertOpen();
    // durability first: the WAL append happens before the memtable sees the write
    appendFileSync(this.#walPath(), JSON.stringify({ k: key, v: value }) + '\n');
    this.#mem.set(key, value);
    if (this.#mem.size >= this.#memMax) this.flush();
  }

  #replayWal(): void {
    const path = this.#walPath();
    if (!existsSync(path)) return;
    const lines = readFileSync(path, 'utf8').split('\n');
    let valid = 0;
    for (const line of lines) {
      if (!line) continue;
      let rec: { k: string; v: string | null };
      try {
        rec = JSON.parse(line);
      } catch {
        break; // torn final write — everything after it is garbage
      }
      this.#mem.set(rec.k, rec.v);
      valid++;
    }
    // rewrite the WAL without the torn tail so future appends start on a clean line
    writeFileSync(path, lines.slice(0, valid).map((l) => l + '\n').join(''));
  }

  /** Size-tiered: while some tier has >= threshold tables, merge exactly those into tier+1. */
  #maybeCompact(): void {
    for (;;) {
      const byTier = new Map<number, number>();
      for (const t of this.#tables) byTier.set(t.tier, (byTier.get(t.tier) ?? 0) + 1);
      const tier = [...byTier].find(([, n]) => n >= this.#threshold)?.[0];
      if (tier === undefined) return;
      // tables of a tier are contiguous in age order (newest first)
      const from = this.#tables.findIndex((t) => t.tier === tier);
      let to = from;
      while (to < this.#tables.length && this.#tables[to].tier === tier) to++;
      this.#merge(from, to, tier + 1);
    }
  }

  /** Merge tables[from, to) (a contiguous age range) into one table at `tier`. */
  #merge(from: number, to: number, tier: number): void {
    const inputs = this.#tables.slice(from, to);
    // tombstones may be dropped only if no OLDER table could still hold the key
    const includesOldest = to === this.#tables.length;
    const merged = new Map<string, string | null>();
    for (const t of inputs) for (const [k, v] of t.sst.entries()) if (!merged.has(k)) merged.set(k, v);
    const entries = [...merged]
      .filter(([, v]) => v !== null || !includesOldest)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const out: LiveTable[] = [];
    if (entries.length) {
      const id = this.#nextId++;
      out.push({ id, tier, sst: SSTable.write(this.#tablePath(id), entries, this.#indexInterval) });
    }
    this.#tables.splice(from, to - from, ...out);
    this.#saveManifest(); // commit point: after this the inputs are garbage
    for (const t of inputs) {
      t.sst.close();
      rmSync(t.sst.path);
    }
  }

  #saveManifest(): void {
    const m: Manifest = { nextId: this.#nextId, tables: this.#tables.map(({ id, tier }) => ({ id, tier })) };
    const path = join(this.#dir, 'MANIFEST');
    writeFileSync(path + '.tmp', JSON.stringify(m));
    renameSync(path + '.tmp', path);
  }

  #tablePath(id: number): string {
    return join(this.#dir, `${id}.sst`);
  }

  #walPath(): string {
    return join(this.#dir, 'wal.log');
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('store is closed');
  }
}
