# Build an LSM-Tree Key-Value Store

```
put/delete ─► WAL (wal.log, append) ─► memtable ──flush──► SSTables (sorted, sparse index, immutable)
                                                              │
                                              size-tiered compaction (merge; drop shadowed + safe tombstones)
get: memtable → newest SSTable → … → oldest (first hit wins; a tombstone means "deleted")
```

## Goal
Implement `SSTable` and `LsmStore` in `src/index.ts`. Everything is synchronous (`node:fs` sync API) and every file lives under the injected `options.dir` (tests use fresh temp dirs).

## Contract the judge checks
- **Files:** WAL at `<dir>/wal.log`; SSTable files end in `.sst` (temp files must not); obsolete `.sst` files are deleted after compaction. Anything else (e.g. a `MANIFEST`) is your choice.
- **SSTable:** `write(path, sortedEntries, indexInterval)` throws on unsorted/duplicate keys. Sparse index has `ceil(count / interval)` entries. `open` loads only the footer + index. `get` reads **one block** (judge: < 4 KB of a 300 KB file) and zero bytes for keys outside `[minKey, maxKey]`. `get` returns `undefined` (absent), `null` (tombstone) or the value.
- **WAL:** append before the memtable. Reopening without `close()` (a crash) must restore every write. If the last record is torn (file truncated mid-record) ignore it and keep the log usable for new appends.
- **Flush:** at `memtableMaxEntries` keys → new tier-0 table, WAL emptied. `flush()` on an empty memtable is a no-op.
- **Compaction (size-tiered):** after each flush, while some tier holds ≥ `compactionThreshold` tables, merge exactly those into one table of tier+1. Keep the newest version of each key. **Drop a tombstone only if the merge includes the oldest table** — otherwise an older table still holds the key and it would come back to life. A merge that ends up empty writes no table.
- **`compact()`:** merge all tables into one (drop all tombstones).
- **`tables()`:** newest first, `{ id, tier, count }`; ids are unique and increase.
- **`close()`** doesn't flush; a closed store throws on use.

## Run
```bash
npm run project -- lsm-kv-store
npm run project -- lsm-kv-store --solution
```

## Hints
- A workable SSTable format: records `keyLen u32 | valLen i32 (-1 = tombstone) | key | value`, then the index (JSON is fine), then a 16-byte footer `indexOffset | indexLength | count | magic`. Read the footer from `size - 16`.
- Make one file the **commit point**: write `MANIFEST.tmp`, then `rename` it over `MANIFEST` (atomic on POSIX). Order matters — write the new table, commit the manifest, *then* truncate the WAL / delete inputs. On open, delete `.sst` files the manifest doesn't list.
- JSON-lines is a fine WAL format: a torn tail fails `JSON.parse`. Real systems add a length + CRC32 per record.
- Tables of one tier are contiguous in age order, so a tier merge replaces a contiguous slice of your newest-first list.

## Stretch goals
- Bloom filter per SSTable so misses skip the disk entirely (measure with `bytesRead`).
- Leveled compaction (non-overlapping key ranges per level) and compare write amplification.
- A skip-list memtable and a streaming k-way merge (heap) instead of materialising whole tables.
- CRC32 per WAL record and per block; `fsync` policy option (every write / group commit / never).
