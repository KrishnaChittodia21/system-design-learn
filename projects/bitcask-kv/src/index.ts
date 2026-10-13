// STARTER — a Bitcask-style log-structured key-value store.
// Implement every function/method below. Run the judge with:  npm run project -- bitcask-kv
// Keep the exported names and signatures: the tests import them.
//
//   disk:   000001.data  000002.data  …  (append-only, CRC-checked records)
//           000007.hint                  (written by merge: key → location, so open skips scanning)
//   memory: keydir  Map<key, { fileId, offset, size }>   — exactly one disk read per get
//
// Use synchronous node:fs calls (openSync, writeSync, readSync with a position, fsyncSync,
// truncateSync…) and `crc32` from node:zlib. Every file lives under opts.dir.

/** crc(4) | keyLen(4) | valueLen(4), all big-endian u32. */
export const HEADER_SIZE = 12;
/** valueLen marker for a delete. */
export const TOMBSTONE = 0xffffffff;

export class CorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorruptionError';
  }
}

/**
 * Encode one record: [crc32][keyLen][valueLen][key bytes (UTF-8)][value bytes].
 * The CRC covers everything after the CRC field. `value === null` encodes a tombstone:
 * valueLen = TOMBSTONE and no value bytes. An empty Buffer is a real (empty) value.
 */
export function encodeRecord(key: string, value: Buffer | null): Buffer {
  throw new Error('Not implemented: encodeRecord');
}

export type Decoded =
  | { kind: 'ok'; key: string; value: Buffer | null; size: number }
  | { kind: 'truncated' }
  | { kind: 'corrupt' };

/**
 * Decode the record starting at `offset` in `buf`. Never throws.
 * Not enough bytes for the header or the body → 'truncated'; CRC mismatch → 'corrupt'.
 * `size` is the record's total byte length; `value` is null for a tombstone.
 */
export function decodeRecord(buf: Buffer, offset: number): Decoded {
  throw new Error('Not implemented: decodeRecord');
}

export type FsyncPolicy = 'always' | 'never' | { everyWrites: number };

export interface BitcaskOptions {
  /** directory holding the files (create it, recursively, if missing) */
  dir: string;
  /** rotate the active file before a write would push it past this size (default 1 MiB) */
  maxFileBytes?: number;
  /** when to fsync the active file after put/delete (default 'never') */
  fsync?: FsyncPolicy;
}

export interface BitcaskStats {
  /** number of .data files on disk */
  dataFiles: number;
  /** total bytes of .data files */
  diskBytes: number;
  liveKeys: number;
  /** fsync calls made because of the policy (put/delete, plus pending writes on rotation/close) */
  fsyncs: number;
  /** hint files used by open() instead of scanning their data files */
  hintFilesLoaded: number;
}

export class Bitcask {
  /** Use Bitcask.open(). */
  constructor(opts: BitcaskOptions) {
    throw new Error('Not implemented: Bitcask.constructor');
  }

  /**
   * Open (or create) a store:
   * - data files are named `${id padded to 6 digits}.data`; process them in ascending id order
   * - if `${id}.hint` exists, load the keydir entries from it instead of scanning the data file
   * - otherwise scan records: puts set the keydir, tombstones delete from it
   * - a truncated or corrupt record in the LAST data file: truncate the file at that offset (a
   *   torn write from a crash) and continue; in any OLDER file: throw CorruptionError
   * - keep appending to the last data file, unless it is a merge output (has a hint file)
   */
  static open(opts: BitcaskOptions): Bitcask {
    throw new Error('Not implemented: Bitcask.open');
  }

  /**
   * Append a record to the active file and point the keydir at it. Before writing, if the
   * active file is non-empty and size + record > maxFileBytes, rotate to a new file with
   * the next id. Apply the fsync policy. Strings are stored as UTF-8.
   */
  put(key: string, value: Buffer | string): void {
    throw new Error('Not implemented: Bitcask.put');
  }

  /** One positioned read at the keydir location; verify the CRC (throw CorruptionError on mismatch). */
  get(key: string): Buffer | undefined {
    throw new Error('Not implemented: Bitcask.get');
  }

  /** Append a tombstone and remove the key. Returns false (and writes nothing) if the key is absent. */
  delete(key: string): boolean {
    throw new Error('Not implemented: Bitcask.delete');
  }

  /** Live keys, sorted. */
  keys(): string[] {
    throw new Error('Not implemented: Bitcask.keys');
  }

  /**
   * Compaction: close the active file; copy every live value into NEW data files (ids above
   * every existing id, rotating by maxFileBytes); write a `.hint` per output (write a temp file,
   * then rename); delete all the old .data and .hint files; repoint the keydir. Later writes
   * go to yet another new file.
   */
  merge(): void {
    throw new Error('Not implemented: Bitcask.merge');
  }

  stats(): BitcaskStats {
    throw new Error('Not implemented: Bitcask.stats');
  }

  /** Close all files. Calling any other method afterwards throws. Closing twice is a no-op. */
  close(): void {
    throw new Error('Not implemented: Bitcask.close');
  }
}
