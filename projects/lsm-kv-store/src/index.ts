// STARTER — implement every method. Run: npm run project -- lsm-kv-store
//
//   put/delete ─► WAL (append) ─► memtable ──flush──► SSTable files (sorted, sparse index)
//                                                        │
//                                         size-tiered compaction (merge, drop shadowed/tombstones)
//
// Use node:fs (the synchronous API is fine and keeps this simple). Every file must live under options.dir.
// File names the judge relies on: the write-ahead log is `<dir>/wal.log`, every SSTable file ends in `.sst`
// (temp files must not), and obsolete .sst files are deleted after compaction.
// Erasable TypeScript only (no enums / parameter properties / namespaces). You may turn the getters
// below into readonly fields and add private fields / a private constructor as you like.

/** A key and its value; `null` is a tombstone (the key was deleted). */
export type Entry = [key: string, value: string | null];

/**
 * Immutable sorted file. You choose the on-disk format; a good one is
 *   [records...][sparse index][fixed-size footer pointing at the index]
 * Opening a table must load ONLY the footer + sparse index into memory (not the data).
 */
export class SSTable {
  /** Write `entries` (must be sorted ascending with unique keys — else throw) to `path`, then open it. */
  static write(path: string, entries: Entry[], indexInterval = 16): SSTable {
    throw new Error('Not implemented: SSTable.write');
  }
  /** Open an existing table, loading only the footer and the sparse index. */
  static open(path: string): SSTable {
    throw new Error('Not implemented: SSTable.open');
  }
  get path(): string {
    throw new Error('Not implemented: SSTable.path');
  }
  /** number of entries (tombstones included) */
  get count(): number {
    throw new Error('Not implemented: SSTable.count');
  }
  /** number of entries in the in-memory sparse index = ceil(count / indexInterval) */
  get indexEntries(): number {
    throw new Error('Not implemented: SSTable.indexEntries');
  }
  /** bytes of the data section read by get/entries since open (open itself not counted) */
  get bytesRead(): number {
    throw new Error('Not implemented: SSTable.bytesRead');
  }
  get minKey(): string | undefined {
    throw new Error('Not implemented: SSTable.minKey');
  }
  get maxKey(): string | undefined {
    throw new Error('Not implemented: SSTable.maxKey');
  }
  /**
   * undefined = key not in this table; null = tombstone; string = value.
   * Binary-search the sparse index and read at most ONE index block from disk.
   * Keys outside [minKey, maxKey] must return without any disk read.
   */
  get(key: string): string | null | undefined {
    throw new Error('Not implemented: SSTable.get');
  }
  /** Entries (tombstones included) with start <= key < end (bounds optional), ascending. */
  entries(start?: string, end?: string): Entry[] {
    throw new Error('Not implemented: SSTable.entries');
  }
  /** Close the file descriptor. */
  close(): void {
    throw new Error('Not implemented: SSTable.close');
  }
}

export interface LsmOptions {
  /** directory that holds every file of this store (create it if missing) */
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
  /** unique, increasing table id (allocate a fresh id for every flush and merge output) */
  id: number;
  /** 0 for a flushed memtable; merging tier-t tables produces one tier-(t+1) table */
  tier: number;
  /** entries in the table (tombstones included) */
  count: number;
}

export class LsmStore {
  /**
   * Open (or create) a store in options.dir: load the table list (a MANIFEST file is the
   * recommended commit point), delete orphan files, and replay the WAL into the memtable.
   * A torn (half-written) final WAL record must be ignored, not crash the open.
   */
  static open(options: LsmOptions): LsmStore {
    throw new Error('Not implemented: LsmStore.open');
  }
  /** Append to the WAL first, then the memtable; flush when the memtable reaches memtableMaxEntries. */
  put(key: string, value: string): void {
    throw new Error('Not implemented: LsmStore.put');
  }
  /** Write a tombstone (WAL + memtable). */
  delete(key: string): void {
    throw new Error('Not implemented: LsmStore.delete');
  }
  /** Memtable first, then SSTables newest → oldest; the first hit wins (a tombstone means undefined). */
  get(key: string): string | undefined {
    throw new Error('Not implemented: LsmStore.get');
  }
  /** Live entries with start <= key < end (bounds optional), ascending; newest version wins; tombstones hidden. */
  scan(start?: string, end?: string): Array<[string, string]> {
    throw new Error('Not implemented: LsmStore.scan');
  }
  /**
   * Write the memtable as a new tier-0 SSTable (no-op when empty), make it durable/visible,
   * empty the WAL, clear the memtable, then (if autoCompact) run size-tiered compaction:
   * while some tier has >= compactionThreshold tables, merge exactly those into one table of tier+1.
   * Merging drops shadowed versions. Tombstones may be dropped ONLY when no older table remains
   * that could still hold the key — otherwise deleted keys come back to life.
   * Delete the input files after the merge is committed.
   */
  flush(): void {
    throw new Error('Not implemented: LsmStore.flush');
  }
  /** Full compaction: merge every table into one (tier = max existing tier), dropping shadowed versions and all tombstones. */
  compact(): void {
    throw new Error('Not implemented: LsmStore.compact');
  }
  /** Live tables, newest first. */
  tables(): TableInfo[] {
    throw new Error('Not implemented: LsmStore.tables');
  }
  /** Number of keys in the memtable (tombstones included). */
  get memtableSize(): number {
    throw new Error('Not implemented: LsmStore.memtableSize');
  }
  /** Release file handles. Does NOT flush: unflushed writes stay in the WAL. Later calls on a closed store throw. */
  close(): void {
    throw new Error('Not implemented: LsmStore.close');
  }
}
