# Build a Bitcask Log-Structured Store

Implement `encodeRecord`, `decodeRecord` and `Bitcask` in `src/index.ts`. The judge is `test/bitcask.test.ts` (16 tests). Each test works in its own temp directory under `os.tmpdir()` and deletes it afterwards.

```bash
npm run project -- bitcask-kv             # judge YOUR code (saves results for the app)
npm run project -- bitcask-kv --no-save   # judge without saving
npm run project -- bitcask-kv --solution  # run the reference solution
```

## Layout

```
<dir>/000001.data   ┐ immutable (older files)
<dir>/000002.data   ┘
<dir>/000003.data   ← active file: every put/delete appends here
<dir>/000004.hint     only for files written by merge
```

**Record** (all integers are big-endian u32):

```
┌────────┬────────┬──────────┬──────────┬────────────┐
│ crc32  │ keyLen │ valueLen │ key …    │ value …    │   crc32 covers keyLen..value
└────────┴────────┴──────────┴──────────┴────────────┘   valueLen 0xFFFFFFFF = tombstone
```

**Hint entry**: `keyLen | offset | size | key`. The format is up to you, since only your own code reads it.

## Behaviour the judge checks

- `put` appends a record and points the keydir at `{ fileId, offset, size }`. `get` does **one** `readSync` at that position and verifies the CRC.
- `delete` appends a tombstone, and only if the key exists.
- **Rotation**: before a write, if the active file is non-empty and would grow past `maxFileBytes`, start `nextId.data`.
- **Open**: process files in id order. Use a hint file when there is one. When scanning, a bad or short record in the **last** file is a torn write: `truncateSync` the file at that offset and carry on. A bad record in an **older** file is real corruption: throw `CorruptionError`.
- **Merge**: copy live values into new files with higher ids, write a hint for each one (temp file, then `renameSync`), and delete **all** the old files. If you kept an old file with a value but dropped its tombstone, the deleted key would come back on reopen. A test checks for this.
- **fsync**: `'always'` syncs after every write, `{ everyWrites: n }` after every n writes, and `'never'` (the default) leaves it to the OS page cache. `stats().fsyncs` counts the calls.

## Interview angles

- **Why it's fast**: writes are sequential appends, and reads cost one seek because the keydir lives in RAM. The catch is that **every key must fit in memory**.
- **What fsync buys**: `write()` only reaches the page cache. Without `fsync` an OS crash or power loss loses the most recent writes, and the CRC plus tail truncation is how you recover cleanly. Compare `synchronous_commit` and the WAL in Postgres.
- **Torn writes**: a crash in the middle of an append leaves half a record. A length prefix plus a CRC detects it.
- **Compaction**: space amplification versus write amplification. Merge rewrites live data, which is the same trade-off LSM trees and Postgres VACUUM make.

## Hints

- Keep one read fd per data file and one append fd (`'a'`) for the active file, and track the active size yourself.
- `fs.readSync(fd, buf, 0, size, offset)` is a positioned read (`pread`).
- `crc32` comes from `node:zlib` (Node ≥ 22.2).

## Stretch goals

- **Lock the directory** (a `LOCK` file opened with `wx`) so two processes can't open the same store.
- Merge only the immutable files while writes continue, and make merge crash-safe: what happens if you crash after writing the hint files but before deleting the old files?
- Add a timestamp and TTL per record, and expire keys during merge.
- Add range scans: why can't Bitcask do them efficiently, and how does an LSM tree fix that?
