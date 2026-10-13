// Reference solution: a Bitcask-style log-structured key-value store.
//
//   disk:   000001.data  000002.data  …  (append-only, CRC-checked records)
//           000007.hint                  (written by merge: key → location, so open skips scanning)
//   memory: keydir  Map<key, { fileId, offset, size }>   — one disk read per get
//
// Writes append to the ACTIVE file; when it would exceed maxFileBytes we rotate to a new one.
// Deletes append a tombstone. Merge rewrites only live values into fresh files plus hints
// and removes the old files. Recovery scans files in id order; a torn/corrupt record at the
// tail of the LAST file is truncated away (that write was never acknowledged as durable).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { crc32 } from 'node:zlib';

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
 * Encode one record: [crc32 of everything after the crc][keyLen][valueLen][key][value].
 * `value === null` encodes a tombstone (valueLen = 0xFFFFFFFF, no value bytes).
 */
export function encodeRecord(key: string, value: Buffer | null): Buffer {
  const k = Buffer.from(key, 'utf8');
  const vLen = value === null ? 0 : value.length;
  const buf = Buffer.alloc(HEADER_SIZE + k.length + vLen);
  buf.writeUInt32BE(k.length, 4);
  buf.writeUInt32BE(value === null ? TOMBSTONE : value.length, 8);
  k.copy(buf, HEADER_SIZE);
  if (value) value.copy(buf, HEADER_SIZE + k.length);
  buf.writeUInt32BE(crc32(buf.subarray(4)), 0);
  return buf;
}

export type Decoded =
  | { kind: 'ok'; key: string; value: Buffer | null; size: number }
  | { kind: 'truncated' }
  | { kind: 'corrupt' };

/** Decode the record starting at `offset` in `buf`. Never throws. */
export function decodeRecord(buf: Buffer, offset: number): Decoded {
  if (buf.length - offset < HEADER_SIZE) return { kind: 'truncated' };
  const crc = buf.readUInt32BE(offset);
  const kLen = buf.readUInt32BE(offset + 4);
  const vRaw = buf.readUInt32BE(offset + 8);
  const vLen = vRaw === TOMBSTONE ? 0 : vRaw;
  const size = HEADER_SIZE + kLen + vLen;
  if (buf.length - offset < size) return { kind: 'truncated' };
  if (crc32(buf.subarray(offset + 4, offset + size)) !== crc) return { kind: 'corrupt' };
  const keyStart = offset + HEADER_SIZE;
  const key = buf.toString('utf8', keyStart, keyStart + kLen);
  const value = vRaw === TOMBSTONE ? null : Buffer.from(buf.subarray(keyStart + kLen, offset + size));
  return { kind: 'ok', key, value, size };
}

export type FsyncPolicy = 'always' | 'never' | { everyWrites: number };

export interface BitcaskOptions {
  /** directory holding the files (created if missing) */
  dir: string;
  /** rotate the active file before a write would push it past this size (default 1 MiB) */
  maxFileBytes?: number;
  /** when to fsync the active file (default 'never') */
  fsync?: FsyncPolicy;
}

export interface BitcaskStats {
  /** number of .data files on disk */
  dataFiles: number;
  /** total bytes of .data files */
  diskBytes: number;
  liveKeys: number;
  /** fsync calls made by put/delete/rotation */
  fsyncs: number;
  /** hint files used by the last open() instead of scanning data files */
  hintFilesLoaded: number;
}

interface Loc {
  fileId: number;
  offset: number;
  size: number;
}

const dataName = (id: number) => `${String(id).padStart(6, '0')}.data`;
const hintName = (id: number) => `${String(id).padStart(6, '0')}.hint`;

/** Hint entry: keyLen(4) | offset(4) | size(4) | key. */
function encodeHint(key: string, loc: Loc): Buffer {
  const k = Buffer.from(key, 'utf8');
  const b = Buffer.alloc(12 + k.length);
  b.writeUInt32BE(k.length, 0);
  b.writeUInt32BE(loc.offset, 4);
  b.writeUInt32BE(loc.size, 8);
  k.copy(b, 12);
  return b;
}

export class Bitcask {
  #dir: string;
  #max: number;
  #policy: FsyncPolicy;
  #keydir = new Map<string, Loc>();
  /** file id → fd opened for reading */
  #readFds = new Map<number, number>();
  #activeId: number | null = null;
  #activeFd: number | null = null;
  #activeSize = 0;
  #maxId = 0;
  #unsynced = 0;
  #fsyncs = 0;
  #hintsLoaded = 0;
  #closed = false;

  /** Use Bitcask.open(). */
  constructor(opts: BitcaskOptions) {
    this.#dir = opts.dir;
    this.#max = opts.maxFileBytes ?? 1024 * 1024;
    this.#policy = opts.fsync ?? 'never';
  }

  /** Open (or create) a store in opts.dir, rebuilding the keydir and repairing a torn tail. */
  static open(opts: BitcaskOptions): Bitcask {
    const db = new Bitcask(opts);
    try {
      db.#load();
    } catch (err) {
      db.close(); // release any fds opened before the failure
      throw err;
    }
    return db;
  }

  #fileIds(): number[] {
    return fs
      .readdirSync(this.#dir)
      .filter((f) => /^\d{6}\.data$/.test(f))
      .map((f) => Number(f.slice(0, 6)))
      .sort((a, b) => a - b);
  }

  #load(): void {
    fs.mkdirSync(this.#dir, { recursive: true });
    const ids = this.#fileIds();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const isLast = i === ids.length - 1;
      this.#maxId = Math.max(this.#maxId, id);
      this.#readFds.set(id, fs.openSync(path.join(this.#dir, dataName(id)), 'r'));
      const hintPath = path.join(this.#dir, hintName(id));
      if (fs.existsSync(hintPath)) {
        this.#loadHint(id, fs.readFileSync(hintPath));
        this.#hintsLoaded++;
        continue;
      }
      this.#scan(id, isLast);
    }
    // Keep appending to the last file unless it is an immutable merge output.
    const last = ids[ids.length - 1];
    if (last !== undefined && !fs.existsSync(path.join(this.#dir, hintName(last)))) this.#openActive(last);
  }

  #loadHint(id: number, buf: Buffer): void {
    let off = 0;
    while (off + 12 <= buf.length) {
      const kLen = buf.readUInt32BE(off);
      const offset = buf.readUInt32BE(off + 4);
      const size = buf.readUInt32BE(off + 8);
      const key = buf.toString('utf8', off + 12, off + 12 + kLen);
      this.#keydir.set(key, { fileId: id, offset, size });
      off += 12 + kLen;
    }
  }

  #scan(id: number, isLast: boolean): void {
    const file = path.join(this.#dir, dataName(id));
    const buf = fs.readFileSync(file);
    let off = 0;
    while (off < buf.length) {
      const rec = decodeRecord(buf, off);
      if (rec.kind !== 'ok') {
        if (!isLast) throw new CorruptionError(`${rec.kind} record in ${dataName(id)} at offset ${off}`);
        // Torn write at the tail of the newest file: cut it off so future appends start clean.
        fs.truncateSync(file, off);
        break;
      }
      if (rec.value === null) this.#keydir.delete(rec.key);
      else this.#keydir.set(rec.key, { fileId: id, offset: off, size: rec.size });
      off += rec.size;
    }
  }

  #openActive(id: number): void {
    const p = path.join(this.#dir, dataName(id));
    this.#activeFd = fs.openSync(p, 'a');
    this.#activeId = id;
    this.#activeSize = fs.fstatSync(this.#activeFd).size;
    if (!this.#readFds.has(id)) this.#readFds.set(id, fs.openSync(p, 'r'));
  }

  #closeActive(): void {
    if (this.#activeFd === null) return;
    if (this.#unsynced > 0 && this.#policy !== 'never') this.#sync();
    fs.closeSync(this.#activeFd);
    this.#activeFd = null;
    this.#activeId = null;
    this.#activeSize = 0;
  }

  #sync(): void {
    fs.fsyncSync(this.#activeFd!);
    this.#fsyncs++;
    this.#unsynced = 0;
  }

  #check(): void {
    if (this.#closed) throw new Error('store is closed');
  }

  #append(rec: Buffer): Loc {
    if (this.#activeFd !== null && this.#activeSize > 0 && this.#activeSize + rec.length > this.#max) this.#closeActive();
    if (this.#activeFd === null) this.#openActive(++this.#maxId);
    const offset = this.#activeSize;
    fs.writeSync(this.#activeFd!, rec);
    this.#activeSize += rec.length;
    this.#unsynced++;
    const p = this.#policy;
    if (p === 'always' || (typeof p === 'object' && this.#unsynced >= p.everyWrites)) this.#sync();
    return { fileId: this.#activeId!, offset, size: rec.length };
  }

  put(key: string, value: Buffer | string): void {
    this.#check();
    const v = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
    this.#keydir.set(key, this.#append(encodeRecord(key, v)));
  }

  /** One positioned read; the record's CRC is verified. */
  get(key: string): Buffer | undefined {
    this.#check();
    const loc = this.#keydir.get(key);
    if (!loc) return undefined;
    const rec = this.#readAt(loc);
    if (rec.kind !== 'ok' || rec.key !== key || rec.value === null) {
      throw new CorruptionError(`bad record for ${key} in ${dataName(loc.fileId)} at ${loc.offset}`);
    }
    return rec.value;
  }

  #readAt(loc: Loc): Decoded {
    const buf = Buffer.alloc(loc.size);
    const n = fs.readSync(this.#readFds.get(loc.fileId)!, buf, 0, loc.size, loc.offset);
    return decodeRecord(n === loc.size ? buf : buf.subarray(0, n), 0);
  }

  /** Append a tombstone. Returns false (and writes nothing) if the key is absent. */
  delete(key: string): boolean {
    this.#check();
    if (!this.#keydir.has(key)) return false;
    this.#append(encodeRecord(key, null));
    this.#keydir.delete(key);
    return true;
  }

  keys(): string[] {
    this.#check();
    return [...this.#keydir.keys()].sort();
  }

  /**
   * Compaction: copy every live value into new files (ids above all current ones), write a
   * hint file per output, then delete all older data and hint files.
   */
  merge(): void {
    this.#check();
    this.#closeActive();
    const old = this.#fileIds();
    if (old.length === 0) return;
    const newLocs = new Map<string, Loc>();
    const outputs: number[] = [];
    let outId = 0;
    let outFd: number | null = null;
    let outSize = 0;
    let hints: Buffer[] = [];
    const finish = () => {
      if (outFd === null) return;
      if (this.#policy !== 'never') fs.fsyncSync(outFd);
      fs.closeSync(outFd);
      const tmp = path.join(this.#dir, hintName(outId) + '.tmp');
      fs.writeFileSync(tmp, Buffer.concat(hints));
      fs.renameSync(tmp, path.join(this.#dir, hintName(outId))); // atomic publish
      outFd = null;
      hints = [];
    };
    for (const key of [...this.#keydir.keys()].sort()) {
      const loc = this.#keydir.get(key)!;
      const rec = this.#readAt(loc);
      if (rec.kind !== 'ok' || rec.value === null) throw new CorruptionError(`bad record for ${key} during merge`);
      const bytes = encodeRecord(key, rec.value);
      if (outFd !== null && outSize > 0 && outSize + bytes.length > this.#max) finish();
      if (outFd === null) {
        outId = ++this.#maxId;
        outputs.push(outId);
        outFd = fs.openSync(path.join(this.#dir, dataName(outId)), 'w');
        outSize = 0;
      }
      const l: Loc = { fileId: outId, offset: outSize, size: bytes.length };
      fs.writeSync(outFd, bytes);
      outSize += bytes.length;
      hints.push(encodeHint(key, l));
      newLocs.set(key, l);
    }
    finish();
    // Switch readers to the new files, then remove the old ones.
    for (const id of old) {
      fs.closeSync(this.#readFds.get(id)!);
      this.#readFds.delete(id);
      fs.rmSync(path.join(this.#dir, dataName(id)), { force: true });
      fs.rmSync(path.join(this.#dir, hintName(id)), { force: true });
    }
    for (const id of outputs) this.#readFds.set(id, fs.openSync(path.join(this.#dir, dataName(id)), 'r'));
    this.#keydir = newLocs;
  }

  stats(): BitcaskStats {
    this.#check();
    const ids = this.#fileIds();
    let diskBytes = 0;
    for (const id of ids) diskBytes += fs.statSync(path.join(this.#dir, dataName(id))).size;
    return { dataFiles: ids.length, diskBytes, liveKeys: this.#keydir.size, fsyncs: this.#fsyncs, hintFilesLoaded: this.#hintsLoaded };
  }

  /** Close all files. Further calls throw. */
  close(): void {
    if (this.#closed) return;
    this.#closeActive();
    for (const fd of this.#readFds.values()) fs.closeSync(fd);
    this.#readFds.clear();
    this.#closed = true;
  }
}
