import type { Topic } from '../../types';

const topic: Topic = {
  id: 'db-postgres-internals',
  phase: 'databases',
  order: 7,
  title: 'Inside PostgreSQL: The Life of a Write and a Read',
  subtitle:
    'Postmaster and backends, the background workers, shared buffers and clock-sweep, heap page and tuple layout, TOAST, the WAL-before-data rule, full-page writes and torn pages, checkpoints and crash recovery, the commit path, the read path through planner, executor and visibility checks, and the tunables that matter when it hurts in production.',
  estimatedMinutes: 120,
  sources: [
    'Arpit Bhayani — Database internals notes (arpitbhayani.me/topics/database-internals): PostgreSQL background processes, on-disk storage forks and pages, process-per-connection model',
    'PostgreSQL 18 docs — Ch 66 Database Physical Storage (66.6 Database Page Layout, 66.2 TOAST)',
    'PostgreSQL 18 docs — Ch 19.4 Resource Consumption (shared_buffers, bgwriter_*, io_method, vacuum_buffer_usage_limit) and 19.5 Write Ahead Log (synchronous_commit, full_page_writes, checkpoints)',
    'PostgreSQL 18 docs — Ch 28 Reliability and the Write-Ahead Log (28.3 WAL, 28.5 WAL Configuration, 28.6 WAL Internals)',
    'PostgreSQL source — src/backend/storage/buffer/README (pins, content locks, clock-sweep, buffer rings) and src/include/storage/buf_internals.h (BM_MAX_USAGE_COUNT = 5)',
    'PostgreSQL 18 release notes (2025-09-25) — asynchronous I/O (io_method), data checksums on by default in initdb, pg_stat_io and pg_stat_checkpointer changes',
    'Hironobu Suzuki — The Internals of PostgreSQL (interdb.jp), Ch 8 Buffer Manager, Ch 9 WAL',
  ],
  tags: ['postgres', 'internals', 'wal', 'shared-buffers', 'clock-sweep', 'heap-page', 'toast', 'checkpoint', 'crash-recovery', 'full-page-writes', 'synchronous-commit', 'buffer-manager'],
  cheatSheet: [
    'Process model: postmaster forks one backend per connection; all of them share one shared-memory segment (shared buffers, WAL buffers, lock table, CLOG cache). A backend crash makes the postmaster kill every backend and run crash recovery, because shared memory may be corrupt.',
    'Background crew: checkpointer (writes all dirty pages, advances the redo point), bgwriter (cleans soon-to-be-evicted buffers every 200 ms, max 100/round), walwriter (flushes WAL every 200 ms), autovacuum launcher + workers, walsender per replica, archiver, and in PG 18 io workers (io_method = worker, 3 by default).',
    'Shared buffers = 8 KB slots + a hash table (tag → buffer id). Replacement is clock-sweep: each pin bumps usage_count up to 5; the hand decrements counts and evicts the first unpinned buffer at 0. Seq scans of tables bigger than shared_buffers/4 use a 256 KB ring so they cannot flush the cache.',
    'Heap page (8 KB): 24-byte header (pd_lsn, pd_checksum, pd_lower, pd_upper…), 4-byte line pointers growing down, tuples growing up from the end. Tuple header is 23 bytes (aligned to 24): xmin, xmax, cid, ctid, infomask2, infomask, hoff. Real per-row overhead ≈ 28 bytes before your columns.',
    'Infomask hint bits (XMIN_COMMITTED, XMAX_INVALID…) cache CLOG lookups in the tuple. The first reader after a bulk load sets them and dirties the pages, so a SELECT can cause writes (and WAL full-page images when checksums are on, the PG 18 default).',
    'TOAST kicks in when a row exceeds ~2 KB: compress (pglz or lz4), then move to a side table in ~2,000-byte chunks behind an 18-byte pointer; max 1 GB per value. Changing one key in a 60 KB jsonb rewrites the whole value.',
    'Write path: build WAL record in WAL buffers → modify page in shared buffers, stamp pd_lsn, mark dirty → COMMIT writes a commit record and flushes WAL up to its LSN → data page is written much later. Rule: a dirty page may hit disk only after WAL up to its pd_lsn is flushed.',
    'full_page_writes = on: the first change to a page after each checkpoint logs the whole 8 KB page so a torn write (8 KB page over 4 KB fs blocks) can be repaired. Shorter checkpoints = more full-page images = more WAL. wal_compression (lz4/zstd) shrinks them.',
    'Checkpoints fire on checkpoint_timeout (5 min) or max_wal_size (1 GB), spread over checkpoint_completion_target (0.9). Recovery replays from the last completed checkpoint\'s redo point, so recovery time ≈ WAL since that point ÷ replay speed.',
    'synchronous_commit = off never corrupts data (unlike fsync = off); it can only lose the last ≤ 3 × wal_writer_delay (600 ms) of acknowledged commits. Use SET LOCAL for re-derivable writes only, never a session-level SET on a pooled connection.',
  ],
  sections: [
    {
      heading: 'The process model: postmaster, backends and one shared-memory segment',
      body: `**Intuition:** PostgreSQL is a small operating system of its own. One supervisor process (the *postmaster*) owns a block of shared memory and forks a dedicated worker process for every client connection. Everything else in this topic happens inside those processes and that shared memory.

**Mechanics:**
- The postmaster listens on 5432. For each new connection it \`fork()\`s a **backend** process that authenticates the client and then runs that session's queries until disconnect. It is a process, not a thread, so each backend has its own private memory (catalog caches, plan cache, \`work_mem\` sort and hash areas, temp buffers).
- At start-up the postmaster allocates **shared memory**: the shared buffer pool, WAL buffers, the lock table, the proc array (who is running which transaction, used to build snapshots), CLOG/SLRU caches for transaction status, and statistics. Every backend attaches to it. This is how one backend's commit becomes visible to another.
- **Crash isolation is coarse.** If any backend dies abnormally (segfault, OOM-killer \`SIGKILL\`), the postmaster cannot know whether it left shared memory half-modified, so it terminates *every* backend, resets shared memory and runs crash recovery from WAL. One bad extension or one OOM kill means a cluster-wide blip of seconds to minutes.

**Why this matters in design:** per-connection processes are why connections are expensive and why poolers exist (covered in *db-connections-locks*). The new angle here: the OOM killer is the most common way to trigger a full restart. A backend with \`work_mem = 256MB\` running a query with 6 hash joins can use 6 × 256 MB × \`hash_mem_multiplier\` (2.0) ≈ 3 GB. Multiply by a few concurrent reports and the kernel picks a backend to kill, and then the postmaster restarts *everything*.

**In interviews say:** "Postgres is process-per-connection over a shared buffer pool. The shared memory is the coordination point, and that is also why a single crashed backend forces cluster-wide recovery."`,
      diagram: `                     +-------------------+
   client --TCP-->   |    postmaster     |  forks, supervises, restarts
                     +---------+---------+
          fork()      |        |        |      fork() background workers
     +----------+ +----------+ +-------------+ +------------+ +-----------+
     | backend  | | backend  | | checkpointer| |  bgwriter  | | walwriter |
     | (conn 1) | | (conn 2) | +-------------+ +------------+ +-----------+
     +----+-----+ +----+-----+ | autovac L+W | | walsender  | | io worker |
          |            |       +------+------+ +-----+------+ +-----+-----+
  ========+============+==============+==============+==============+=====
  SHARED MEMORY: shared_buffers | WAL buffers | lock table | proc array |
                 CLOG/SLRU caches | buffer mapping hash | stats
  ======================================================================
          |                                         |
     data files (base/<db>/<relfilenode>[.1..])   pg_wal/ 16 MB segments`,
      code: [
        {
          language: 'sql',
          title: 'See the process tree from inside the database',
          code: `-- Every process attached to shared memory shows up here, not only client sessions.
SELECT pid, backend_type, state, wait_event_type, wait_event,
       left(query, 60) AS query
FROM pg_stat_activity
ORDER BY backend_type, pid;

-- Typical backend_type values:
--   client backend, autovacuum launcher, autovacuum worker, checkpointer,
--   background writer, walwriter, walsender, archiver, io worker (PG 18),
--   logical replication launcher, startup (on a standby or during recovery)

-- Private memory per backend: check the biggest consumers (PG 14+)
SELECT name, total_bytes / 1024 / 1024 AS mb
FROM pg_backend_memory_contexts
ORDER BY total_bytes DESC
LIMIT 5;`,
        },
      ],
      keyPoints: [
        'One process per connection plus a fixed crew of background processes, all attached to one shared-memory segment.',
        'A backend crash makes the postmaster restart all backends and run crash recovery.',
        'work_mem is per sort or hash node, not per session, so OOM kills come from multiplication.',
      ],
      source: 'Arpit Bhayani — notes on PostgreSQL process-per-connection model; PostgreSQL 18 docs — 19.4 Resource Consumption',
    },
    {
      heading: 'The background crew: who writes what, and what breaks when each falls behind',
      body: `**Intuition:** client backends should spend their time running queries. Slow disk work (flushing WAL, writing dirty pages, cleaning dead rows) is handed to specialist processes. When a specialist falls behind, the work lands back on your query path, and that is when latency jumps.

| Process | Job | Key knobs | Symptom when it falls behind |
|---|---|---|---|
| **checkpointer** | Writes *every* dirty buffer, then writes a checkpoint record and moves the redo point forward; also does fsync of data files | \`checkpoint_timeout\` (5 min), \`max_wal_size\` (1 GB), \`checkpoint_completion_target\` (0.9) | I/O saw-tooth, "checkpoints are occurring too frequently" log lines, WAL bloat |
| **background writer** | Every \`bgwriter_delay\` (200 ms) writes up to \`bgwriter_lru_maxpages\` (100) dirty buffers that the clock hand will reach soon | \`bgwriter_lru_multiplier\` (2.0) | Client backends write their own dirty victims (\`pg_stat_io\` writes by *client backend*), adding I/O wait to queries |
| **walwriter** | Flushes WAL buffers every \`wal_writer_delay\` (200 ms) or after \`wal_writer_flush_after\` (1 MB) | \`wal_buffers\` | Async commits wait longer; commits flush WAL themselves |
| **autovacuum launcher + workers** | Removes dead tuples, sets visibility-map bits, freezes old xids | \`autovacuum_max_workers\`, cost limits | Bloat, index-only scans stop being index-only, wraparound warnings (see *db-fundamentals*) |
| **walsender** (one per replica or slot) | Streams WAL to standbys and logical consumers | \`max_wal_senders\` | Replication lag, WAL retained by slots |
| **archiver** | Copies finished 16 MB WAL segments to the archive | \`archive_command\` / \`archive_library\` | \`pg_wal\` fills the disk if archiving fails |
| **io workers** (PG 18) | Run asynchronous reads when \`io_method = worker\` (default; 3 workers) | \`io_workers\`, \`io_method\` (\`worker\`, \`io_uring\`, \`sync\`) | Read-ahead does not keep up on large scans |

**Two ideas to take away:**
1. The checkpointer and bgwriter differ in *purpose*. The checkpointer writes dirty pages to bound **recovery time**. The bgwriter writes them to keep **clean victims** available for the clock-sweep. Both write the same buffers, but for different reasons.
2. In PostgreSQL 17+ the checkpointer's counters moved from \`pg_stat_bgwriter\` to \`pg_stat_checkpointer\`, and \`pg_stat_io\` (PG 16+) shows who did each write. If most writes come from \`client backend\`, your queries are paying for I/O that a background process should have done.`,
      code: [
        {
          language: 'sql',
          title: 'Who is doing the writes? (PG 16+ pg_stat_io, PG 17+ pg_stat_checkpointer)',
          code: `-- Writes to relation data, grouped by the process type that did them.
SELECT backend_type, context,
       sum(writes)    AS writes,
       sum(evictions) AS evictions,
       sum(fsyncs)    AS fsyncs
FROM pg_stat_io
WHERE object = 'relation'
GROUP BY backend_type, context
ORDER BY writes DESC NULLS LAST;
-- Healthy: checkpointer and background writer dominate writes.
-- Unhealthy: 'client backend' in context 'normal' has many writes, meaning
-- queries are evicting dirty pages themselves.

-- Timed vs requested checkpoints (requested = forced by max_wal_size or manual)
SELECT num_timed, num_requested, num_done,
       write_time / 1000 AS write_s, sync_time / 1000 AS sync_s,
       buffers_written
FROM pg_stat_checkpointer;   -- PG 17+; num_done added in PG 18`,
        },
      ],
      keyPoints: [
        'Checkpointer bounds recovery time; bgwriter keeps clean victims ready; walwriter flushes WAL asynchronously.',
        'pg_stat_io tells you which process did each write. Client-backend writes are a smell.',
        'Many requested (not timed) checkpoints mean max_wal_size is too small for your WAL rate.',
      ],
      source: 'Arpit Bhayani — "When you start your PostgreSQL database, a bunch of background processes…"; PostgreSQL 18 docs — 19.4.4 Background Writer, 27.2 pg_stat_io',
    },
    {
      heading: 'Shared buffers and the clock-sweep replacement algorithm',
      body: `**Intuition:** shared buffers are a fixed parking lot of 8 KB slots. To park a new page you must find a slot nobody is using and nobody has used recently. PostgreSQL does not keep a true LRU list, because that needs a global lock on every hit. It uses a **clock** instead: a hand that sweeps round the slots and gives each recently used page a few "second chances".

**Mechanics (from \`src/backend/storage/buffer/README\`):**
- Each buffer has a header holding the **buffer tag** (which relation, fork and block it contains), flags (dirty, valid), a **pin count** and a **usage_count**.
- Lookup goes through a shared **buffer mapping hash table** (tag → buffer id), split into 128 lock partitions so backends do not serialise on one lock.
- **Pin** = "I am using this buffer, do not evict it". A pin can be held for a long time (a cursor). A **content lock** (shared or exclusive) is a short-term lock on the bytes of the page. You must pin before you lock.
- Every pin increments \`usage_count\`, capped at **5** (\`BM_MAX_USAGE_COUNT\`).
- On a miss, the backend advances \`nextVictimBuffer\` (the clock hand). For each buffer under the hand: if it is pinned or has \`usage_count > 0\`, decrement the count and move on. The first unpinned buffer with count 0 is the victim. If the victim is dirty, it must be written first, and before that the WAL up to the page's LSN must be flushed.

**Consequences you can reason about:**
- A page that was very hot a minute ago survives at most **5 passes** of the hand after it goes cold, no matter how many hits it had. The cap stops a burst of hits from pinning a page in cache forever.
- **Buffer rings** protect the cache from one-off bulk work. A sequential scan of a table bigger than a quarter of \`shared_buffers\` recycles a private **256 KB** ring. VACUUM uses a ring sized by \`vacuum_buffer_usage_limit\` (**2 MB** default since PG 17). COPY and CREATE TABLE AS use a **16 MB** ring. A full-table UPDATE dirties every page, and dirty ring buffers whose WAL is not yet flushed are dropped from the ring, so a big UPDATE effectively falls back to the normal strategy and *does* churn the cache.
- **Double buffering.** Postgres reads through the OS page cache (unless you use direct I/O, which is not the default), so a page can be cached twice. This is why the classic advice is \`shared_buffers\` ≈ **25% of RAM**, leaving the rest to the OS cache and to \`work_mem\`. Going to 70–80% shrinks the OS cache and makes checkpoints write a larger dirty set at once.
- Turn on **huge pages** (\`huge_pages = try\` is the default) for buffer pools over a few GB. With 4 KB pages, the page tables of 400 backends mapping 32 GB add up to gigabytes of kernel memory.`,
      code: [
        {
          language: 'sql',
          title: 'Inspect the buffer pool with pg_buffercache',
          code: `CREATE EXTENSION IF NOT EXISTS pg_buffercache;

-- Which relations occupy shared_buffers, and how "hot" are they?
SELECT c.relname,
       count(*)                                   AS buffers,
       pg_size_pretty(count(*) * 8192)            AS cached,
       round(avg(b.usagecount), 2)                AS avg_usage,   -- 0..5
       sum(CASE WHEN b.isdirty THEN 1 ELSE 0 END) AS dirty
FROM pg_buffercache b
JOIN pg_class c
  ON b.relfilenode = pg_relation_filenode(c.oid)
 AND b.reldatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
GROUP BY c.relname
ORDER BY buffers DESC
LIMIT 10;

-- Distribution of usage counts: many buffers at 5 means a hot working set;
-- most at 0-1 means the pool is churning (too small, or scans thrash it).
SELECT usagecount, count(*) FROM pg_buffercache GROUP BY 1 ORDER BY 1;`,
        },
      ],
      keyPoints: [
        'Clock-sweep: usage_count up to 5 per pin, decremented by the hand; evict the first unpinned buffer at 0.',
        'Rings (256 KB scan, 2 MB vacuum, 16 MB bulk write) stop one-off bulk work from flushing the cache.',
        'shared_buffers ≈ 25% of RAM because the OS page cache double-buffers; enable huge pages for big pools.',
      ],
      source: 'PostgreSQL source — src/backend/storage/buffer/README, buf_internals.h; PostgreSQL 18 docs — 19.4.1 Memory',
    },
    {
      heading: 'Anatomy of a heap page: header, line pointers and free space',
      body: `**Intuition:** a heap page is a slotted page. There is a small table of contents at the front (line pointers) and the actual rows are stacked from the back. Free space is the gap in the middle. Because rows are referenced by slot number and not by byte offset, a row can be moved within the page (during pruning or compaction) without changing its address.

**The 24-byte page header (\`PageHeaderData\`):**
| Field | Bytes | Meaning |
|---|---|---|
| \`pd_lsn\` | 8 | LSN of the last WAL record that changed this page. This is the "WAL before data" check. |
| \`pd_checksum\` | 2 | Page checksum. On by default for new clusters from PG 18 (\`initdb --no-data-checksums\` to opt out). |
| \`pd_flags\` | 2 | e.g. PD_HAS_FREE_LINES, PD_PAGE_FULL, PD_ALL_VISIBLE |
| \`pd_lower\` | 2 | Offset to the end of the line-pointer array |
| \`pd_upper\` | 2 | Offset to the start of the newest tuple |
| \`pd_special\` | 2 | Start of special space (empty on heap pages; B-tree pages keep sibling links here) |
| \`pd_pagesize_version\` | 2 | Page size and layout version |
| \`pd_prune_xid\` | 4 | Oldest xmax on the page that might be prunable, a hint for opportunistic pruning |

- **Line pointers** (\`ItemIdData\`, 4 bytes each): offset, length and state (NORMAL, REDIRECT for HOT chains, DEAD, UNUSED).
- **Free space** = \`pd_upper - pd_lower\`. The **free space map** (the \`_fsm\` fork) stores an approximate free-space value per page so an INSERT can find room without reading pages.
- A row's physical address is the **ctid** = (block number, line pointer index), e.g. \`(1042, 7)\`. Indexes store ctids. That is why a non-HOT UPDATE, which creates a new ctid, needs new index entries (HOT and fillfactor are covered in *db-indexing* and *db-fundamentals*).
- Each relation is stored in files of up to **1 GB** (\`<relfilenode>\`, \`.1\`, \`.2\`…) with sibling forks: \`_fsm\` (free space map) and \`_vm\` (visibility map, 2 bits per page: all-visible and all-frozen).

**What this buys you in production:** you can reason about table size from first principles. With \`pageinspect\` you can debug "why is this table 3× bigger than its data?" by looking at real line pointers.`,
      diagram: `  One 8 KB heap page (offsets in bytes)
  0                                                                  8191
  +---------------------+------+------+------+-----------------------+
  | PageHeaderData (24) | lp 1 | lp 2 | lp 3 | ->   free space   <-   |
  | pd_lsn  pd_checksum | 4 B  | 4 B  | 4 B  |                       |
  | pd_lower pd_upper   |  |      |      |   ^ pd_lower   pd_upper ^ |
  +---------------------+--|------|------|---------------------------+
  |         ...free...     |      |      +-------------+              |
  |                        |      +--------+           |              |
  |                        v               v           v              |
  |  ... | tuple 3 (newest) | tuple 2       | tuple 1 (oldest)         |
  +------------------------------------------------------------------+
         ^ tuples grow toward the header           special space (0 B
           line pointers grow toward the tuples     on heap pages) ^`,
      code: [
        {
          language: 'sql',
          title: 'Look inside a real page with pageinspect',
          code: `CREATE EXTENSION IF NOT EXISTS pageinspect;

CREATE TABLE acct (id int PRIMARY KEY, balance bigint);
INSERT INTO acct VALUES (1, 100), (2, 200);
UPDATE acct SET balance = 150 WHERE id = 1;   -- creates a new tuple version

-- Page header of block 0
SELECT lsn, checksum, lower, upper, special, prune_xid
FROM page_header(get_raw_page('acct', 0));

-- Line pointers and tuple headers
SELECT lp, lp_off, lp_len, t_xmin, t_xmax, t_ctid,
       t_infomask::bit(16) AS infomask, t_hoff
FROM heap_page_items(get_raw_page('acct', 0));
--  lp | t_xmin | t_xmax | t_ctid
--   1 |   7001 |   7002 | (0,3)   <- old version of id=1, points to its successor
--   2 |   7001 |      0 | (0,2)   <- id=2, never updated: ctid points to itself
--   3 |   7002 |      0 | (0,3)   <- new version of id=1`,
        },
      ],
      keyPoints: [
        'Slotted page: 24-byte header, 4-byte line pointers growing down, tuples growing up from the end.',
        'ctid = (block, line pointer); indexes point at ctids; pd_lsn ties each page to the WAL.',
        'Relations are 1 GB segment files plus _fsm and _vm forks.',
      ],
      source: 'PostgreSQL 18 docs — 66.6 Database Page Layout; Arpit Bhayani — note on where and how PostgreSQL stores table data',
    },
    {
      heading: 'The tuple header: xmin, xmax, ctid and the infomask hint bits',
      body: `**Intuition:** every row version carries a small passport. It says who created it (\`xmin\`), who deleted or replaced it (\`xmax\`), where its successor lives (\`ctid\`), and a set of stamps (hint bits) that say "I already checked, the creator really committed". The MVCC rules themselves are covered in *db-fundamentals*. Here we look at the bytes and their side effects.

**\`HeapTupleHeaderData\` = 23 bytes, padded to 24 (MAXALIGN 8):**
| Field | Bytes | Use |
|---|---|---|
| \`t_xmin\` | 4 | Inserting transaction id |
| \`t_xmax\` | 4 | Deleting or locking transaction id (0 = live). Row locks (\`SELECT … FOR UPDATE\`) also set xmax, with a lock-only infomask bit, which is why row locks dirty pages |
| \`t_cid\` / \`t_xvac\` | 4 | Command id inside the transaction (so a statement does not see its own later changes) |
| \`t_ctid\` | 6 | Self, or the successor version after an UPDATE |
| \`t_infomask2\` | 2 | Number of attributes + HOT flags (HEAP_HOT_UPDATED, HEAP_ONLY_TUPLE) |
| \`t_infomask\` | 2 | Hint and state bits: HEAP_XMIN_COMMITTED, HEAP_XMIN_INVALID, HEAP_XMAX_COMMITTED, HEAP_XMAX_INVALID, HEAP_HASNULL, HEAP_XMAX_LOCK_ONLY… |
| \`t_hoff\` | 1 | Offset to user data (after the optional null bitmap, MAXALIGNed) |

**Hint bits, the hidden write in your reads:**
- To decide whether \`xmin\` committed, a reader must look up the transaction status in **CLOG** (\`pg_xact\`, 2 bits per xid, cached in SLRU buffers). That lookup is expensive, so the first reader that learns "7001 committed" sets \`HEAP_XMIN_COMMITTED\` on the tuple. Every later reader skips CLOG.
- Setting a hint bit **dirties the page**. After a bulk load of 200 M rows, the first \`SELECT count(*)\` sets bits on every tuple and leaves every page dirty, so the checkpointer has to write the whole table again.
- With **data checksums on** (the default for new clusters from PG 18) or \`wal_log_hints = on\`, the first hint-bit change to a page after a checkpoint must write a **full-page image** to WAL, because a torn write would otherwise break the checksum. That read can therefore generate gigabytes of WAL and replication traffic.
- **Fix:** run \`VACUUM (ANALYZE)\` (or \`VACUUM (FREEZE)\` for append-only history) right after bulk loads, during the load window. It sets hint bits, visibility-map bits and statistics in one pass, before user traffic arrives.

**Alignment is real space:** columns are aligned to their type's alignment (int8/timestamptz to 8, int4 to 4). Ordering columns from widest to narrowest (8-byte, then 4, then 2, then 1-byte and variable-length) can save several bytes per row. On a billion-row table that is gigabytes.`,
      code: [
        {
          language: 'sql',
          title: 'Hint bits in action: a SELECT that writes',
          code: `CREATE TABLE events (id bigint, payload text);
INSERT INTO events SELECT g, md5(g::text) FROM generate_series(1, 5000000) g;
CHECKPOINT;   -- pages written, but hint bits are not set yet

-- Count the buffers written and the WAL generated by a "read-only" query
SELECT pg_current_wal_lsn() AS before \\gset
EXPLAIN (ANALYZE, BUFFERS, WAL) SELECT count(*) FROM events;
--   Buffers: shared read=46729 dirtied=46729   <- the read dirtied every page
--   WAL: fpi=46729 bytes=...                   <- full-page images if checksums are on
SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), :'before'));

-- Second run: no dirtied buffers, no WAL. The hints are already set.
EXPLAIN (ANALYZE, BUFFERS, WAL) SELECT count(*) FROM events;

-- Production fix: do this work inside the load window instead.
VACUUM (ANALYZE) events;`,
        },
      ],
      keyPoints: [
        'Tuple header = 23 bytes (24 aligned) + 4-byte line pointer ≈ 28 bytes of overhead per row version.',
        'Hint bits cache CLOG results inside the tuple; setting them dirties pages and can emit full-page images.',
        'VACUUM (ANALYZE) after bulk loads moves that cost into the load window.',
      ],
      source: 'PostgreSQL 18 docs — 66.6.1 Table Row Layout, 19.5 wal_log_hints; PostgreSQL wiki — Hint Bits',
    },
    {
      heading: 'TOAST: what happens to a 60 KB jsonb value',
      body: `**Intuition:** a row must fit in an 8 KB page, but a value can be up to 1 GB. TOAST (The Oversized-Attribute Storage Technique) squeezes big values: it compresses them first, and if they are still too big it slices them into chunks stored in a hidden side table. The main row keeps only a small pointer.

**Mechanics:**
- When a row is wider than \`TOAST_TUPLE_THRESHOLD\` (about **2 KB**), Postgres processes the widest TOAST-able columns until the row fits under \`TOAST_TUPLE_TARGET\` (about 2 KB; you can change it per table with \`toast_tuple_target\`).
- Per-column **storage strategy**: \`EXTENDED\` (compress, then move out of line; the default for text, jsonb and bytea), \`EXTERNAL\` (out of line, no compression, which makes substring reads on big text fast), \`MAIN\` (compress, move out only as a last resort), \`PLAIN\` (never; fixed-width types).
- Compression: \`pglz\` (the default) or \`lz4\` (PG 14+, much faster to compress and decompress). Set it per column with \`ALTER TABLE … ALTER COLUMN … SET COMPRESSION lz4\`, or globally with \`default_toast_compression\`.
- Out-of-line values live in \`pg_toast.pg_toast_<oid>\` as rows of about **2,000-byte chunks** (sized so four fit on a page), indexed by (value id, chunk seq). The main tuple keeps an **18-byte TOAST pointer**.

**Where it hurts:**
1. **Read amplification.** \`SELECT *\` on a list endpoint fetches and decompresses every chunk of every big column. A 50-row page with a 60 KB jsonb column that does not compress well reads up to about 1,500 extra chunk rows (50 × 30 chunks). Select only the columns you need. If an ORM entity loads the blob, split it into a separate table or a lazy relation.
2. **Write amplification.** jsonb is stored as one value. \`UPDATE … SET doc = jsonb_set(doc, '{views}', …)\` writes a **whole new compressed value** (all its chunks), a new heap tuple and WAL for all of it, and leaves the old chunks dead for vacuum. A counter inside a 60 KB document turns each +1 into tens of KB of WAL. Move hot, small, frequently updated fields into normal columns.
3. **TOAST table bloat.** The TOAST table is vacuumed separately (autovacuum handles it, and you can tune it with \`toast.autovacuum_*\` reloptions). Check \`pg_total_relation_size\` against \`pg_relation_size\`, because the difference includes TOAST and indexes.
4. **Unchanged TOAST values are not rewritten.** If an UPDATE does not touch the big column, the new tuple version reuses the same TOAST pointer. That is why splitting hot columns away from big ones works.`,
      code: [
        {
          language: 'sql',
          title: 'Measure TOAST and move hot fields out of the blob',
          code: `-- How much of the table is really TOAST?
SELECT pg_size_pretty(pg_relation_size('profiles'))        AS heap,
       pg_size_pretty(pg_relation_size(reltoastrelid))     AS toast,
       pg_size_pretty(pg_total_relation_size('profiles'))  AS total
FROM pg_class WHERE relname = 'profiles';

-- Size of the stored (possibly compressed) value vs. the logical size
SELECT id, pg_column_size(doc) AS stored_bytes, octet_length(doc::text) AS raw_bytes,
       pg_column_compression(doc) AS method                -- pglz | lz4 | NULL
FROM profiles ORDER BY stored_bytes DESC LIMIT 5;

-- Faster compression for new values (existing values keep their method)
ALTER TABLE profiles ALTER COLUMN doc SET COMPRESSION lz4;

-- Anti-pattern: a counter inside a 60 KB document rewrites the whole value
-- UPDATE profiles SET doc = jsonb_set(doc, '{views}', to_jsonb((doc->>'views')::int + 1));
-- Fix: a narrow column. Unchanged TOAST pointers are reused; often a HOT update.
ALTER TABLE profiles ADD COLUMN views bigint NOT NULL DEFAULT 0;
UPDATE profiles SET views = views + 1 WHERE id = $1;`,
        },
      ],
      keyPoints: [
        'Rows over ~2 KB: compress (pglz/lz4), then move out of line in ~2,000-byte chunks behind an 18-byte pointer; values can be up to 1 GB.',
        'Updating any part of a jsonb value rewrites the whole value plus its WAL.',
        'Keep hot small fields in their own columns, and avoid SELECT * on blob-heavy tables.',
      ],
      source: 'PostgreSQL 18 docs — 66.2 TOAST; 19.11 default_toast_compression',
    },
    {
      heading: 'The life of a write: from UPDATE to bytes on disk',
      body: `**Intuition:** Postgres never writes your change to the table file at commit time. It writes a compact description of the change to a sequential log (the WAL), flushes that log, and tells you "committed". The table page is updated in memory and written to disk minutes later, often together with hundreds of other changes. Sequential log writes are cheap and random page writes are expensive, so the design defers the expensive part.

**Step by step: \`UPDATE accounts SET balance = balance - 100 WHERE id = 42; COMMIT;\`**
1. **Find the row.** The executor walks the index and gets ctid \`(1042, 7)\`. It pins buffer (accounts, block 1042), loading it from disk or the OS cache if it is not in shared buffers, and takes an **exclusive content lock** on it.
2. **Check and lock the row.** The executor checks visibility and that no concurrent transaction holds the row (via xmax). It sets the old tuple's \`xmax\` to our xid.
3. **Write the new version.** If there is room on the same page and no indexed column changed, this is a **HOT** update (no index changes). Otherwise the tuple goes to another page and every index gets a new entry.
4. **Log it.** Inside a critical section, \`XLogInsert()\` copies a WAL record (heap UPDATE: old ctid, new tuple data, flags) into the **WAL buffers** and returns its LSN. If this is the first change to the page since the last checkpoint, the record carries a **full-page image** instead.
5. **Stamp and dirty.** \`pd_lsn\` of page 1042 is set to that LSN, the buffer is marked **dirty**, and the content lock is released. Nothing has touched disk yet.
6. **COMMIT.** A commit WAL record is inserted. \`XLogFlush(commitLSN)\` writes and \`fdatasync\`s \`pg_wal\` up to that LSN. Concurrent committers piggyback on the same flush (**group commit**). Then the transaction is marked committed in **CLOG** and removed from the proc array, so new snapshots see it, and the client gets \`COMMIT\`.
7. **Later (seconds to minutes).** The bgwriter, the checkpointer, or a backend that needs a free buffer writes page 1042 to the data file. Before it does, it calls \`XLogFlush(pd_lsn)\`. This **WAL-before-data rule** guarantees that the log always describes every change that reached the data file.
8. **At the next checkpoint**, page 1042 is written if still dirty and fsynced. Once a checkpoint completes, WAL before its redo point is no longer needed for crash recovery, so it can be recycled (unless archiving, replication slots or \`wal_keep_size\` keep it).

**What is durable when COMMIT returns** (with \`synchronous_commit = on\`, no sync standby): the WAL up to the commit record is on stable storage. The data page probably is *not*. A crash now is recovered by replaying that WAL onto the last-checkpointed page.

**Cost model:** one commit ≈ one WAL fsync. NVMe with power-loss protection: ~50–200 µs. Cloud block storage (EBS gp3, PD-SSD): ~0.5–2 ms. That is why 1 row per transaction tops out at a few thousand commits/s per connection pool, while 1,000 rows per transaction is close to free per row.`,
      diagram: `  backend                         shared memory                 disk
  -------                         -------------                 ----
  UPDATE ... ---------> (4) XLogInsert --> [ WAL buffers ]
            |                                    |
            +---------> (5) modify page --> [ shared buffer 1042 ]
                            pd_lsn = LSN        dirty, pinned
  COMMIT ----> (6) commit record -> WAL buffers
               XLogFlush(commitLSN) ---------------------> pg_wal/0000...0A
               (fdatasync, group commit)                   sequential write
               CLOG: xid = committed
  <---- "COMMIT"   (data page still only in memory)

  later:   bgwriter / checkpointer / evicting backend
           (7) XLogFlush(pd_lsn) first  --> WAL-before-data rule
               write page 1042 ----------------------------> base/16384/24576
           (8) checkpoint: fsync data files, write checkpoint record,
               move redo point, recycle old WAL segments`,
      code: [
        {
          language: 'sql',
          title: 'Watch the WAL records of one UPDATE (PG 15+ pg_walinspect)',
          code: `CREATE EXTENSION IF NOT EXISTS pg_walinspect;

SELECT pg_current_wal_insert_lsn() AS start_lsn \\gset
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 42;
COMMIT;
SELECT pg_current_wal_insert_lsn() AS end_lsn \\gset

SELECT start_lsn, resource_manager, record_type, record_length,
       fpi_length, block_ref
FROM pg_get_wal_records_info(:'start_lsn', :'end_lsn');
--  resource_manager | record_type | record_length | fpi_length
--  Heap             | HOT_UPDATE  |            74 |          0   <- page already logged since checkpoint
--  Transaction      | COMMIT      |            34 |          0
-- Run CHECKPOINT first and repeat: the HOT_UPDATE record now carries an
-- ~8 KB full-page image (fpi_length > 0, minus the free-space "hole").`,
        },
      ],
      keyPoints: [
        'A change is a WAL record plus an in-memory page change; COMMIT only forces the WAL to disk.',
        'WAL-before-data: a page can be written only after WAL up to its pd_lsn is flushed.',
        'Commit latency ≈ one WAL fsync (µs on local NVMe, ~1 ms on cloud disks); group commit amortises it.',
      ],
      source: 'PostgreSQL 18 docs — 28.3 Write-Ahead Logging, 28.6 WAL Internals; The Internals of PostgreSQL — Ch 9',
    },
    {
      heading: 'Torn pages and full_page_writes: why the first change after a checkpoint is expensive',
      body: `**Intuition:** a Postgres page is 8 KB, but the disk and file system promise atomic writes only in smaller units (512 B or 4 KB sectors and blocks). If power fails mid-write, the page on disk can be half old and half new: a **torn page**. A WAL record that says "change bytes 300–340 of this page" cannot fix a page whose other half is garbage. So after each checkpoint Postgres logs the *whole page* the first time it touches it. Recovery then starts from a known-good image.

**Mechanics:**
- With \`full_page_writes = on\` (the default), the first modification of each page after a checkpoint's redo point writes a **full-page image (FPI)** into WAL. The "hole" between \`pd_lower\` and \`pd_upper\` is skipped, so a half-empty page logs less than 8 KB.
- During recovery, replay restores the FPI over whatever is on disk (torn or not), then applies the later records for that page.
- **WAL volume depends on checkpoint frequency.** Right after a checkpoint, every first touch emits ~8 KB instead of ~100 bytes. That is why WAL rate (and replication traffic) **spikes right after each checkpoint** and decays as pages get "already logged". A 1-minute \`checkpoint_timeout\` can produce several times more WAL than 15 minutes for the same workload.
- **\`wal_compression\`** (\`pglz\`, \`lz4\`, \`zstd\`; off by default) compresses only FPIs. On FPI-heavy workloads lz4 often cuts total WAL by 2–3× for a few percent CPU.
- Hint-bit-only changes normally do not write WAL. With data checksums (default from PG 18) or \`wal_log_hints\`, the first hint-bit change after a checkpoint writes an FPI, because a torn hint-bit write would make the checksum fail.

**Can you turn it off?** Only if the storage *guarantees* atomic 8 KB writes, for example ZFS (copy-on-write, never overwrites in place) or some cloud volumes with documented atomic 16 KB writes. On ext4/xfs over ordinary block devices, \`full_page_writes = off\` trades less WAL for **silent corruption after a power loss**, which checksums would detect but not repair. The docs class this as a similar risk to \`fsync = off\`, though smaller. In an interview, the right answer is: lengthen the checkpoint interval and compress FPIs, and keep FPWs on.

**Related:** standbys and PITR need the FPIs too (a base backup is torn by definition, since it is copied while the database writes). That is why \`pg_basebackup\` forces full-page writes for the backup's duration.`,
      diagram: `  8 KB page = 2 x 4 KB fs blocks. Power fails during the write:

  on disk BEFORE     write in flight       on disk AFTER crash
  +-------+-------+  +-------+-------+     +-------+-------+
  | old A | old B |  | new A | new B |     | new A | old B |  <- torn
  +-------+-------+  +-------+-------+     +-------+-------+

  Recovery without FPI: apply "set bytes 5000..5040" on a torn page -> garbage
  Recovery with FPI:   restore full image from WAL (first change since
                       checkpoint), then apply later records -> correct page

  WAL bytes/s over one checkpoint cycle (full_page_writes = on):
  |#####                      #####
  |######                     ######
  |#########                  #########
  |#############.........     #############.......
  +---------------------------+-----------------------> time
  ^ checkpoint                ^ checkpoint (FPIs again)`,
      keyPoints: [
        'Torn page = partial 8 KB write; row-level WAL cannot repair it, a full-page image can.',
        'FPIs are written on the first change to each page after a checkpoint, so WAL spikes after every checkpoint.',
        'Lengthen checkpoints and enable wal_compression = lz4; do not disable full_page_writes on ordinary filesystems.',
      ],
      source: 'PostgreSQL 18 docs — 19.5.1 full_page_writes, wal_compression, wal_log_hints; 28.1 Reliability',
    },
    {
      heading: 'Checkpoints and crash recovery: bounding the replay',
      body: `**Intuition:** without checkpoints, recovering from a crash would mean replaying the WAL from the day the cluster was created. A checkpoint is a promise: "every change logged before point R is now in the data files". After a crash, replay can start at R.

**What a checkpoint does:**
1. Record the current WAL insert position as the **redo point** (R).
2. Write **every dirty buffer** in shared buffers, throttled so it finishes in about \`checkpoint_completion_target × checkpoint_timeout\` (0.9 × 5 min = 4.5 min by default), then \`fsync\` the touched data files.
3. Write a **checkpoint record** to WAL and update \`pg_control\` with its location.
4. Remove or recycle WAL segments that are older than R and not needed by archiving, replication slots or \`wal_keep_size\`.

**Triggers:** \`checkpoint_timeout\` elapsed (5 min default, range 30 s–1 d), WAL since the last checkpoint approaching \`max_wal_size\` (1 GB default, a *soft* limit), manual \`CHECKPOINT\`, shutdown, the start or end of a base backup. If WAL-triggered checkpoints arrive closer than \`checkpoint_warning\` (30 s), the log says *"checkpoints are occurring too frequently"*. On a write-heavy system the 1 GB default is almost always too small.

**Crash recovery:** the startup process reads \`pg_control\`, finds the last completed checkpoint record, jumps back to its **redo point** (not the record itself, because changes made *during* the checkpoint are only in WAL), and replays every WAL record forward, one at a time in a single process. For each record it reads the target page and applies the change only if \`page LSN < record LSN\`. This idempotence check makes replay safe to repeat. When replay reaches the end of valid WAL, the database opens.
- **Recovery time ≈ WAL since the redo point ÷ replay rate.** Replay is single-threaded and random-read bound on a cold cache (\`recovery_prefetch\`, PG 15+, helps). Worst case, a crash just before a checkpoint completes, means replaying almost two checkpoint intervals of WAL.
- On a **standby**, the same machinery runs continuously. Its version of a checkpoint is a *restartpoint*, which it can perform only at checkpoints recorded in the primary's WAL.

**The trade-off you tune:**
| Longer checkpoints (e.g. 15–30 min, \`max_wal_size\` 16–64 GB) | Shorter checkpoints (1–5 min) |
|---|---|
| Fewer FPIs → much less WAL and replication traffic | More FPIs → more WAL |
| A page modified 100× is written once | More repeated writes of hot pages |
| Longer crash recovery (minutes) | Fast recovery |
| More \`pg_wal\` disk needed | Less disk |

With HA (Patroni and a sync standby), failover to the replica usually beats waiting for local crash recovery. That makes long checkpoint intervals much safer, and it is why managed services tune them high.`,
      code: [
        {
          language: 'bash',
          title: 'Read the control file and spot checkpoint pressure',
          code: `# Where would recovery start? (run as the postgres OS user)
pg_controldata "$PGDATA" | grep -E 'Latest checkpoint location|REDO location|Time of latest checkpoint'
# Latest checkpoint location:           3A/9F0012C8
# Latest checkpoint's REDO location:    3A/7C000028   <- replay starts HERE
# Time of latest checkpoint:            Mon 12 Oct 2026 10:00:00 IST

# WAL between redo and now = what a crash right now would replay
psql -Atc "SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), '3A/7C000028'))"

# Log lines worth alerting on (log_checkpoints = on is the default since PG 15)
grep -E 'checkpoints are occurring too frequently|checkpoint complete' postgresql-*.log | tail -5
# LOG: checkpoint complete: wrote 412311 buffers (39.3%); ... write=269.8 s, sync=1.9 s,
#      total=272.1 s; distance=9812345 kB, estimate=10240000 kB`,
        },
      ],
      keyPoints: [
        'Checkpoint = redo point + write and fsync all dirty pages + checkpoint record; replay starts at the redo point.',
        'Triggers: checkpoint_timeout or max_wal_size (soft). Frequent WAL-triggered checkpoints mean max_wal_size is too small.',
        'Recovery time scales with WAL since the redo point; HA failover often makes longer intervals acceptable.',
      ],
      source: 'PostgreSQL 18 docs — 28.5 WAL Configuration, 19.5.2 Checkpoints; pg_controldata reference',
    },
    {
      heading: 'The commit path in depth: what each synchronous_commit level actually waits for',
      body: `**Intuition:** COMMIT is a promise about what survives which failure. Each \`synchronous_commit\` level moves the point where Postgres says "done" further along the chain: memory → local disk → standby memory → standby disk → standby visible. Each step adds latency. *db-replication* covers the levels as a replication choice; here we look at the local mechanics, the failure each one survives and how to use them per write class.

| Level | Waits for | Survives | Typical added latency |
|---|---|---|---|
| \`off\` | Nothing. The WAL writer flushes within ≤ 3 × \`wal_writer_delay\` (600 ms) | Backend crash, but **not** an OS crash or power loss: the last ≤ 600 ms of acked commits can vanish. **No corruption**, ever | ~0 (no fsync on the commit path) |
| \`local\` | Local WAL flush only, even if sync standbys are configured | Local crash | 1 local fsync |
| \`remote_write\` | Local flush + standby wrote WAL to its OS (not fsynced) | Primary loss; standby *process* crash, but not both machines losing power | + 1 network RTT |
| \`on\` (default) | Local flush + standby **flushed** WAL | Loss of either machine | + RTT + standby fsync |
| \`remote_apply\` | + standby **replayed** it (visible to queries there) | Same as \`on\`, plus read-your-writes on that standby | + replay delay (can be large during replay conflicts) |

Without \`synchronous_standby_names\`, only \`off\` versus everything else matters: all other levels behave like \`on\` (a local flush).

**Mechanics worth knowing:**
- **Group commit is automatic.** While one backend fsyncs, others queue up their commit records and the next flush covers them all. \`commit_delay\` (µs, default 0) with \`commit_siblings\` (default 5) makes a committer wait a little to batch more. It helps only on slow-fsync storage with many concurrent writers. Measure before using it.
- **\`off\` is not \`fsync = off\`.** \`synchronous_commit = off\` only delays the WAL flush, so WAL stays ordered and recovery stays consistent. \`fsync = off\` lets the OS reorder or drop writes, and a crash can leave an **unrecoverable, corrupt** cluster. Never use it outside throwaway CI databases.
- **Scope it.** \`SET LOCAL\` inside a transaction affects only that transaction. A bare \`SET\` on a pooled connection leaks into whichever request uses that connection next, and with PgBouncer in transaction mode it can land on a different client's session.
- **Visibility before durability (\`off\`):** other sessions can read your async commit before it is flushed. If the server then crashes, they acted on data that disappeared. Use \`off\` only for data you can lose or re-derive: click logs, last-seen timestamps, metrics.`,
      code: [
        {
          language: 'typescript',
          title: 'Per-write-class durability with node-postgres (NestJS service)',
          code: `import { Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

type Durability = 'off' | 'local' | 'on' | 'remote_apply';

@Injectable()
export class TxRunner {
  constructor(private readonly pool: Pool) {}

  // SET LOCAL scopes the setting to this transaction only, so it can never
  // leak to the next user of this pooled connection.
  async run<T>(durability: Durability, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Not a parameterisable statement: whitelist the value via the union type.
      await client.query(\`SET LOCAL synchronous_commit = \${durability}\`);
      const result = await fn(client);
      await client.query('COMMIT');   // the durability wait happens here
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}

// Usage:
//   money movement   -> runner.run('on', ...)            survives losing a machine
//   read-your-write  -> runner.run('remote_apply', ...)  then read from that standby
//   last_seen_at     -> runner.run('off', ...)           losing <= 600 ms is fine`,
        },
      ],
      keyPoints: [
        'off ≤ local < remote_write < on < remote_apply: each waits one step further along the chain.',
        'synchronous_commit = off can lose ≤ 600 ms of acked commits but never corrupts; fsync = off can corrupt.',
        'Always SET LOCAL inside a transaction; session-level SET leaks through connection pools.',
      ],
      source: 'PostgreSQL 18 docs — 19.5.1 synchronous_commit, commit_delay; 28.4 Asynchronous Commit',
    },
    {
      heading: 'The life of a read: parser, planner, executor, buffer lookup and visibility',
      body: `**Intuition:** a SELECT is a pipeline. The query text becomes a tree, the planner picks the cheapest physical plan using statistics, and the executor pulls rows one at a time through plan nodes. Each row passes two checks: "is the page in memory?" and "is this row version visible to my snapshot?". EXPLAIN reading is covered in *db-indexing*. This section follows a single row through the machinery.

**\`SELECT balance FROM accounts WHERE id = 42;\` (READ COMMITTED)**
1. **Parse and analyse:** SQL → parse tree → query tree, with names resolved through the catalog caches in backend-local memory. Rules and views are expanded by the **rewriter**.
2. **Plan:** the planner estimates costs from \`pg_statistic\` (n_distinct, MCVs, histograms, correlation) and cost constants (\`seq_page_cost\` 1.0, \`random_page_cost\` 4.0, which you should lower to ~1.1 on SSD). With more than \`geqo_threshold\` (12) FROM items it switches to a genetic search. Prepared statements may switch to a **generic plan** after 5 executions if it is not costlier, which is a classic cause of a "suddenly slow" parameterised query on skewed data (\`plan_cache_mode\`).
3. **Snapshot:** at the start of each statement (READ COMMITTED) or the first statement of the transaction (REPEATABLE READ), the backend builds a snapshot from the proc array: \`xmin\` (every xid below it is finished), \`xmax\` (every xid at or above it is invisible) and \`xip[]\` (the xids in progress between them).
4. **Execute (Volcano model):** \`ExecutorRun\` calls the top node's next-row function repeatedly. Index Scan → descend the B-tree → ctid \`(1042, 7)\`.
5. **Buffer lookup:** hash (relfilenode, fork, block 1042) → buffer mapping table (128 partitions) → hit: pin and bump usage_count. Miss: clock-sweep for a victim (write it first if dirty), read the block through the OS (PG 18 can issue these reads asynchronously via \`io_method\`), verify the checksum, insert it in the mapping table.
6. **Visibility check** (\`HeapTupleSatisfiesMVCC\`) on the tuple at line pointer 7:
   - Hint bit \`XMIN_COMMITTED\` set? Skip CLOG. Not set → is xmin in my snapshot's in-progress list? → otherwise check CLOG and set the hint bit (a write).
   - xmax invalid or aborted → visible. xmax committed and not in my snapshot's in-progress list → deleted for me → invisible. xmax in progress (in \`xip\`) → still visible to me.
7. **Return:** project \`balance\`, send a DataRow message, unpin the buffer.

**Index-only scans and the visibility map:** an index-only scan skips step 6 for pages whose **all-visible** bit is set in the \`_vm\` fork. If vacuum lags, the bits are unset, every row costs a heap visit, and "Heap Fetches" in EXPLAIN climbs. The fix for that is autovacuum tuning, not a new index.`,
      diagram: `  SQL text
     |  parser + analyzer (catalog cache)        backend-private memory
     v
  query tree --> rewriter (views, rules) --> planner (pg_statistic, costs)
                                               |
                                               v
                  plan tree:   Index Scan on accounts_pkey (id = 42)
                                               |  ExecutorRun: next row?
                                               v
  B-tree descent --> ctid (1042,7)
                       |
                       v                        shared memory
           +-- buffer mapping hash (rel, fork, 1042) --+
           | hit  -> pin, usage_count++                 |
           | miss -> clock-sweep victim, (flush WAL,    |
           |         write if dirty), read block, verify|
           |         checksum, insert in hash           |
           +--------------------------------------------+
                       |
                       v
     visibility: hint bits? -> snapshot xmin/xmax/xip -> CLOG (sets hints)
                       |
                       v
               project columns -> DataRow -> client`,
      keyPoints: [
        'Snapshot = xmin, xmax and the in-progress xid list, taken per statement (RC) or per transaction (RR).',
        'Every row: buffer mapping lookup (pin), then a visibility check (hint bits → snapshot → CLOG).',
        'Index-only scans depend on visibility-map bits that only VACUUM sets.',
      ],
      source: 'PostgreSQL 18 docs — Ch 52 Overview of PostgreSQL Internals, 13.2 Transaction Isolation; Arpit Bhayani — "How PostgreSQL Generates All Query Execution Plans" (video)',
    },
    {
      heading: 'Where it hurts in production: symptoms, internal causes and tunables',
      body: `**Intuition:** almost every Postgres performance incident that is not a bad query plan is one of these internals pushing work back onto the request path. Learn to map **symptom → mechanism → knob**.

| Symptom | Internal cause | What to check | Fix / tunable |
|---|---|---|---|
| p99 write latency spikes every few minutes | Checkpoint write and fsync bursts | \`pg_stat_checkpointer\`, log \`write=… sync=…\` | Raise \`max_wal_size\` so checkpoints are timed, keep \`checkpoint_completion_target\` 0.9, faster disks |
| WAL rate and replica lag jump right after each checkpoint | Full-page images | \`pg_walinspect\` fpi_length, \`pg_stat_wal.wal_fpi\` | Longer \`checkpoint_timeout\`, \`wal_compression = lz4\` |
| Queries stuck in \`IO / DataFileWrite\` waits | Backends evicting dirty victims themselves | \`pg_stat_io\` writes by client backend | Raise \`bgwriter_lru_maxpages\` and multiplier, bigger \`shared_buffers\` |
| Commit latency ≈ 2–10 ms, \`WALSync\` / \`WALWrite\` waits | Slow WAL fsync, one row per transaction | Wait events, \`pg_stat_wal\` | Batch writes, WAL on a separate fast volume, \`synchronous_commit = off\` for re-derivable data |
| A "read-only" report generates GBs of WAL | Hint bits + checksums → FPIs | EXPLAIN (BUFFERS, WAL) shows dirtied/fpi | \`VACUUM (ANALYZE)\` after loads |
| Table much larger than its data | Row overhead, alignment padding, dead tuples, TOAST | \`pgstattuple\`, \`pg_column_size\` | Column ordering, vacuum tuning, split blobs |
| Updating one jsonb field is slow and bloats | TOAST rewrite of the whole value | \`pg_column_size\` | Move hot fields to columns |
| Whole cluster restarts for ~30 s | A backend was OOM-killed → postmaster resets shared memory | dmesg, \`terminated by signal 9\` | Cap \`work_mem\` × concurrency, \`vm.overcommit_memory = 2\`, pooler |
| Restart after crash takes 15 min | Lots of WAL since the redo point, single-threaded replay | \`pg_controldata\` REDO location | Shorter interval *or* rely on HA failover; \`recovery_prefetch\` |
| Cache hit ratio drops during an analytics job | Big UPDATE or a mid-size scan bypassing rings | \`pg_buffercache\` usagecount spread | Run on a replica, batch updates |

**Starting-point config for a dedicated 64 GB / 16 vCPU OLTP primary on NVMe (PG 18):** \`shared_buffers = 16GB\`, \`huge_pages = on\`, \`effective_cache_size = 48GB\`, \`work_mem = 32MB\` (with ≤ 100 server connections behind a pooler), \`maintenance_work_mem = 2GB\`, \`max_wal_size = 32GB\`, \`checkpoint_timeout = 15min\`, \`checkpoint_completion_target = 0.9\`, \`wal_compression = lz4\`, \`wal_buffers = -1\` (→ 16 MB), \`random_page_cost = 1.1\`, \`bgwriter_lru_maxpages = 400\`, \`io_method = worker\` (or \`io_uring\` on recent Linux). Then measure, because every one of these is a hypothesis.

**Interview framing:** when asked "the database is slow", name which internal process is doing work on the request path. Is a backend writing pages, waiting on WAL fsync, detoasting blobs, or replaying after a restart? That one sentence separates a senior answer from "add an index".`,
      keyPoints: [
        'Map symptom → mechanism → knob: checkpoint bursts, FPIs, backend evictions, WAL fsync, hint bits, TOAST, OOM resets.',
        'Most fixes move work off the request path (bgwriter, longer checkpoints, vacuum after loads, batching).',
        'Treat config values as hypotheses; verify with pg_stat_io, pg_stat_checkpointer, pg_walinspect and wait events.',
      ],
      source: 'PostgreSQL 18 docs — 27.2 Monitoring Statistics, 19.4–19.7; Arpit Bhayani — PostgreSQL internals notes',
    },
  ],
  codeChallenges: [
    {
      id: 'db-postgres-internals-cc-1',
      title: 'An ingest worker that is bound by WAL fsync and leaves a write storm behind',
      context:
        'A NestJS worker consumes device telemetry from Kafka (about 8,000 readings/s at peak) and writes it into Postgres on a cloud disk with ~1.5 ms fsync latency. Readings can be replayed from Kafka for 7 days. The team sees the worker max out at ~1,200 rows/s, WAL fsync waits dominate, `last_seen_at` updates on the `devices` table bloat it, and the first dashboard query each morning is slow and generates WAL.',
      task:
        'Rewrite the worker so it sustains peak load with headroom, keeps durability where it matters, and does not push hint-bit or bloat costs onto the dashboard. Explain each internal mechanism you are working with.',
      starter: {
        language: 'typescript',
        title: 'telemetry.worker.ts (naive)',
        code: `import { Pool } from 'pg';

const pool = new Pool({ max: 20 });

// Called once per Kafka message
export async function handleReading(r: { deviceId: string; ts: string; payload: object }) {
  const client = await pool.connect();
  try {
    // One row per transaction: autocommit, so one WAL flush per INSERT
    await client.query(
      'INSERT INTO readings (device_id, ts, payload) VALUES ($1, $2, $3)',
      [r.deviceId, r.ts, JSON.stringify(r.payload)],
    );

    // Hot counter-style update on a wide row that also has a 40 KB jsonb "config"
    await client.query(
      \`UPDATE devices
          SET meta = jsonb_set(meta, '{last_seen_at}', to_jsonb($2::text))
        WHERE id = $1\`,
      [r.deviceId, r.ts],
    );
  } finally {
    client.release();
  }
}

// Heartbeats are "unimportant", so someone made them faster.
export async function recordHeartbeat(deviceId: string) {
  const client = await pool.connect();
  try {
    await client.query('SET synchronous_commit = off'); // session-level, stays on this connection
    await client.query('UPDATE devices SET heartbeat_at = now() WHERE id = $1', [deviceId]);
  } finally {
    client.release(); // goes back to the pool still set to off
  }
}

// Nightly cron: bulk backfill of 50M rows from S3, then nothing else.
export async function backfill(rows: AsyncIterable<string[]>) {
  for await (const row of rows) {
    await pool.query('INSERT INTO readings (device_id, ts, payload) VALUES ($1, $2, $3)', row);
  }
}`,
      },
      hints: [
        'Count how many WAL flushes the starter does per reading, and what limits the rate of a single connection that waits for each one.',
        'Which of these writes can be re-derived from Kafka, and how would you scope a durability change so it cannot leak to other users of a pooled connection?',
        'What does `jsonb_set` on a column stored next to a 40 KB TOASTed value write, and what does the first reader of 50M freshly loaded rows have to write?',
      ],
      solution: {
        language: 'typescript',
        title: 'telemetry.worker.ts (batched, scoped durability, post-load maintenance)',
        code: `import { Pool } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const pool = new Pool({ max: 4 }); // a few busy connections beat 20 idle-waiting ones

type Reading = { deviceId: string; ts: string; payload: object };

// Called by kafkajs eachBatch with up to ~1,000 messages. Offsets are committed
// only after this resolves, so a crash means Kafka replays the batch.
export async function handleBatch(batch: Reading[]): Promise<void> {
  if (batch.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Readings are re-derivable from Kafka (7-day retention), so an async
    // commit is safe. SET LOCAL dies with this transaction and cannot leak.
    await client.query('SET LOCAL synchronous_commit = off');

    // One multi-row INSERT via unnest: one WAL commit record per batch
    await client.query(
      \`INSERT INTO readings (device_id, ts, payload)
       SELECT * FROM unnest($1::uuid[], $2::timestamptz[], $3::jsonb[])
       ON CONFLICT (device_id, ts) DO NOTHING\`, // idempotent on Kafka replay
      [batch.map((r) => r.deviceId), batch.map((r) => r.ts), batch.map((r) => JSON.stringify(r.payload))],
    );

    // last_seen_at lives in a narrow side table: small tuple, no TOAST rewrite,
    // usually a HOT update (no indexed column changes, fillfactor 80 on it).
    const latest = new Map<string, string>();
    for (const r of batch) if ((latest.get(r.deviceId) ?? '') < r.ts) latest.set(r.deviceId, r.ts);
    await client.query(
      \`INSERT INTO device_last_seen (device_id, last_seen_at)
       SELECT * FROM unnest($1::uuid[], $2::timestamptz[])
       ON CONFLICT (device_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
       WHERE device_last_seen.last_seen_at < EXCLUDED.last_seen_at\`,
      [[...latest.keys()], [...latest.values()]],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err; // kafkajs retries the batch; ON CONFLICT keeps it idempotent
  } finally {
    client.release();
  }
}

// Backfill: COPY streams rows through a 16 MB bulk-write ring (does not trash
// shared_buffers) with one commit, then pay the hint-bit/visibility cost now.
export async function backfill(csvLines: AsyncIterable<string>): Promise<void> {
  const client = await pool.connect();
  try {
    const sink = client.query(copyFrom('COPY readings (device_id, ts, payload) FROM STDIN (FORMAT csv)'));
    await pipeline(Readable.from(csvLines), sink);
    // Sets hint bits + visibility map + stats inside the load window, so the
    // morning dashboard neither dirties 50M rows' pages nor emits FPIs.
    await client.query('VACUUM (ANALYZE) readings');
  } finally {
    client.release();
  }
}`,
      },
      explanation: `**What was wrong and why each fix works:**
- **One WAL flush per row.** Autocommit INSERT plus UPDATE means two commits per reading, each waiting for an fsync of ~1.5 ms. One connection therefore manages about 660 commits/s, or ~330 readings/s. The 20 connections also contend for the same WAL flush and the same hot \`devices\` rows, which is why the observed ceiling was ~1,200 rows/s. Batching 1,000 readings per transaction turns 2,000 fsync waits into 1.
- **Leaky session SET.** \`recordHeartbeat\` runs \`SET synchronous_commit = off\` without \`LOCAL\`. The setting stays on that pooled connection, so whichever code borrows it next (readings today, payments tomorrow) silently and unpredictably loses durability. \`SET LOCAL\` inside \`BEGIN\` is scoped to the transaction. Async commit is justified *only* because Kafka can replay, and offsets are committed after the DB call.
- **Idempotency.** With async commit, a crash can lose the last ~600 ms of acked batches. Kafka replays them, and \`ON CONFLICT DO NOTHING\` on (device_id, ts) makes the replay harmless.
- **TOAST rewrite.** \`jsonb_set\` on \`meta\` writes a whole new jsonb value (plus WAL) for a timestamp change, and the 40 KB \`config\` in the same wide row bloats the table. A narrow \`device_last_seen\` table keeps updates small and often HOT. Collapsing the batch to the latest timestamp per device cuts the update count further.
- **Bulk load.** Row-by-row backfill is slow and fills shared buffers. \`COPY\` uses the bulk-write ring and one commit. The \`VACUUM (ANALYZE)\` afterwards sets hint bits and all-visible bits, so the first dashboard query does not dirty every page (and, with checksums on, write a full-page image for each).
- **Fewer connections.** Four connections each committing 1,000-row batches easily sustain 8,000 rows/s. Twenty connections only add contention and memory.`,
      followUps: [
        {
          q: 'The product team now says some readings are billing-relevant and must never be lost once acknowledged to the device. What changes?',
          a: 'Split by write class. Billing readings go through a transaction with `synchronous_commit = on` (and `remote_write` or `on` with a sync standby if you need to survive losing the primary), and Kafka offsets are committed only after COMMIT returns. Telemetry stays async. Do not flip the whole worker to `on`. Batching still amortises the flush: 1,000 billing rows per COMMIT cost about one fsync (~1.5 ms) plus a standby RTT, which is cheap per row.',
        },
        {
          q: 'How would you prove the backfill no longer causes the morning WAL storm?',
          a: 'Run the dashboard query with `EXPLAIN (ANALYZE, BUFFERS, WAL)` after the backfill and confirm `dirtied=0` and `WAL: fpi=0`. Compare `pg_stat_wal.wal_fpi` and `wal_bytes` deltas across the morning window before and after the change. Also check that `pg_stat_user_tables.last_vacuum` for `readings` is inside the load window, and that `pg_visibility_map_summary(\'readings\')` reports nearly all pages all-visible.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-cc-2',
      title: 'Fix a postgresql.conf that causes checkpoint storms, huge WAL and OOM restarts',
      context:
        'A 64 GB RAM, 16 vCPU primary on NVMe serves an OLTP API (about 6,000 writes/s, ~25 MB/s of WAL) with a synchronous standby in another AZ. Symptoms: p99 latency spikes every ~40 s, replication traffic 3× higher than expected, two cluster-wide restarts last month logged as "server process was terminated by signal 9", and a crash recovery once took 20 minutes. Someone "tuned" the config below.',
      task:
        'Rewrite the config with a short justification per line, tied to the internal mechanism. Keep durability for acknowledged writes intact.',
      starter: {
        language: 'text',
        title: 'postgresql.conf (current)',
        code: `max_connections = 1500            # every pod gets its own pool of 30
shared_buffers = 52GB             # "more cache is always better"
huge_pages = off
work_mem = 256MB                  # reports were slow once
maintenance_work_mem = 8GB
checkpoint_timeout = 30s          # "keep recovery fast"
max_wal_size = 1GB
checkpoint_completion_target = 0.5
full_page_writes = off            # WAL was too big
wal_compression = off
fsync = off                       # benchmark looked 4x faster
synchronous_commit = remote_apply # globally, for read-your-writes everywhere
bgwriter_lru_maxpages = 0         # "checkpointer does the writing anyway"
random_page_cost = 4.0`,
      },
      hints: [
        'Two lines here can corrupt the cluster after a power loss. Find them first, before tuning for speed.',
        'At ~25 MB/s of WAL, how often does a 1 GB max_wal_size force a checkpoint, and what does each checkpoint do to full-page-image volume?',
        'Multiply work_mem by plausible sort/hash nodes and by 1,500 possible backends, and compare with what is left after a 52 GB buffer pool.',
      ],
      solution: {
        language: 'text',
        title: 'postgresql.conf (fixed, PG 18)',
        code: `# Connections: pooler (PgBouncer, transaction mode) in front, few server backends
max_connections = 200              # ~100 active + headroom; pods talk to the pooler
# Memory: leave room for OS page cache (double buffering) and backend memory
shared_buffers = 16GB              # ~25% of RAM
huge_pages = on                    # page tables for a 16 GB pool across backends
effective_cache_size = 48GB        # planner hint only, allocates nothing
work_mem = 32MB                    # per sort/hash node; raise per session for reports
maintenance_work_mem = 2GB         # autovacuum_max_workers x this is the real cap
# Checkpoints: time-driven, spread out, fewer full-page images
checkpoint_timeout = 15min
max_wal_size = 48GB                # 25 MB/s x 900 s = ~22 GB per cycle, 2x headroom
checkpoint_completion_target = 0.9
# Torn-page protection stays on; shrink the images instead
full_page_writes = on
wal_compression = lz4
fsync = on                         # never off on a database you cannot recreate
# Durability default for money paths; relax per transaction with SET LOCAL
synchronous_commit = on            # remote_apply only via SET LOCAL where needed
# Let the bgwriter keep clean victims ready so backends do not write pages
bgwriter_lru_maxpages = 400
bgwriter_lru_multiplier = 3.0
# NVMe: random reads cost almost the same as sequential
random_page_cost = 1.1
log_checkpoints = on`,
      },
      explanation: `**Line by line:**
- **\`fsync = off\` and \`full_page_writes = off\`** are the dangerous pair. The first lets the OS reorder or drop writes; the second leaves torn 8 KB pages unrepairable. Either one can turn a power cut into silent corruption. Both go back **on**. WAL size is handled with \`wal_compression = lz4\` and longer checkpoints instead.
- **Checkpoint storm.** 1 GB ÷ 25 MB/s ≈ 41 s, so \`max_wal_size\`, not the 30 s timeout, was forcing a checkpoint about every 40 s: the latency spikes. With \`completion_target = 0.5\`, each one wrote its dirty set in half that time. Every checkpoint also restarts full-page images, which is why WAL and replication traffic were inflated. With 15 min, 48 GB and 0.9, checkpoints are timed and spread over ~13.5 min.
- **Recovery time.** The 20-minute recovery came from slow, single-threaded replay plus constant checkpoint I/O. With a sync standby you fail over in seconds instead of waiting for local recovery, so a 15-minute interval is acceptable. Size it with WAL rate × interval ÷ replay speed.
- **Memory and OOM.** 52 GB of buffers leaves ~12 GB for the OS cache *and* 1,500 backends. One report with 4 hash nodes at 256 MB × 2.0 hash multiplier ≈ 2 GB, so a handful of reports gets a backend OOM-killed. The postmaster then resets *all* backends: the "signal 9" restarts. A 16 GB pool, a pooler, \`work_mem = 32MB\` and per-session increases fix the multiplication.
- **\`huge_pages = on\`** cuts the page-table overhead of mapping a large pool into many processes.
- **\`synchronous_commit = remote_apply\`** globally makes every commit wait for the standby to *replay*, so replay stalls (recovery conflicts) leak into every API call. Default to \`on\` and use \`SET LOCAL … remote_apply\` only for the writes that need read-your-writes from that standby.
- **\`bgwriter_lru_maxpages = 0\`** disables the bgwriter, so backends evict dirty pages themselves on the request path. Enable and raise it, then confirm with \`pg_stat_io\`.
- **\`random_page_cost = 1.1\`** on NVMe stops the planner from over-penalising index scans.`,
      followUps: [
        {
          q: 'After the change, recovery-time objective review says a local crash must restart in under 3 minutes even without failover. How do you size checkpoints for that?',
          a: 'Measure replay speed (for example, replay a day of archived WAL on a test box; assume ~100 MB/s on a cold NVMe cache). The worst case replays about 1.9 checkpoint intervals of WAL (the previous interval plus 90% of the current one). At 25 MB/s: 3 min = 180 s × 100 MB/s = 18 GB budget; 18 GB ÷ (1.9 × 25 MB/s) ≈ 380 s, so `checkpoint_timeout ≈ 6min` and `max_wal_size ≈ 20GB`. Accept the extra FPI volume and keep lz4 compression on.',
        },
        {
          q: 'How would you verify that backends no longer write pages themselves?',
          a: 'Snapshot `pg_stat_io` (object = relation, context = normal) before and after a peak hour and compare `writes` per `backend_type`. Client backend writes should be a small fraction of background writer plus checkpointer writes. Also watch the `IO:DataFileWrite` and `LWLock:BufferMapping` wait events in `pg_stat_activity` sampling, and check that `maxwritten_clean` in `pg_stat_bgwriter` is not climbing (that means the bgwriter keeps hitting its per-round cap).',
        },
      ],
    },
  ],
  interviewQuestions: [
    {
      id: 'db-postgres-internals-iq-01',
      difficulty: 'expert',
      question:
        'Walk me through, at the level of processes, memory and disk, what Postgres does between your NestJS service sending `UPDATE wallets SET balance = balance - 500 WHERE id = 9` and receiving `COMMIT`. At the moment COMMIT returns, what exactly is on disk and what is only in memory?',
      whatInterviewerLooksFor: [
        'Orders the steps correctly: buffer pin and lock, WAL record, page modification and pd_lsn, commit record, WAL flush, CLOG',
        'States clearly that the data page is usually NOT on disk at commit',
        'Explains the WAL-before-data rule and who writes the page later',
        'Knows the commit cost is one fsync, shared by group commit',
      ],
      modelAnswer: `### The path
1. **Backend.** My connection's dedicated backend parses and plans the query, then the executor finds ctid \`(blk, lp)\` through the primary-key index.
2. **Buffer.** It pins the heap page in shared buffers (on a miss, clock-sweep finds a victim and the page is read in) and takes an exclusive content lock.
3. **Row.** It checks visibility and row locks, sets \`xmax\` = my xid on the old version, and writes a new version, HOT if the page has room and no indexed column changed.
4. **WAL.** It inserts a heap-update WAL record into the WAL buffers, as a full 8 KB page image if this is the page's first change since the last checkpoint. It stamps \`pd_lsn\` with the record's LSN, marks the buffer dirty and releases the lock.
5. **COMMIT.** It inserts a commit record and calls \`XLogFlush\` up to that LSN: write plus \`fdatasync\` of \`pg_wal\`. Other committers share the flush (group commit). With a sync standby and \`synchronous_commit = on\`, it also waits for the standby to flush. Then it marks the xid committed in CLOG and leaves the proc array, so new snapshots see it.

### What is durable when COMMIT returns
- **On disk:** the WAL up to and including my commit record (and on the standby's disk, if synchronous).
- **Only in memory:** the modified heap page, the index pages and the CLOG page. Hint bits are not set yet.
- The bgwriter, the checkpointer or an evicting backend writes the page later, and each must first flush WAL up to \`pd_lsn\` (**WAL before data**). If we crash first, recovery starts from the last checkpoint's redo point and replays my record onto the old page image (or onto the FPI).

### Numbers
One commit ≈ one WAL fsync: ~0.1 ms on local NVMe, ~1 ms on cloud block storage, plus a cross-AZ RTT (~1 ms) with a sync standby. That is why I batch writes and why commit latency, not CPU, bounds single-row-per-transaction throughput.`,
      followUps: [
        {
          q: 'What if the server loses power after the WAL fsync but before the client receives the COMMIT message?',
          a: 'The transaction is durable and will be visible after recovery, but the client sees a connection error and does not know the outcome. This is the "unknown outcome" problem. The client must retry idempotently (an idempotency key or a unique constraint) or check the state, not blindly re-run the debit.',
        },
        {
          q: 'Why does Postgres not simply write the data page at commit time instead of WAL?',
          a: 'A commit would then need random writes to every touched heap and index page (plus fsyncs) instead of one sequential append. Pages are also 8 KB, so a write can tear. Deferring page writes lets a hot page absorb hundreds of commits per write, and the sequential WAL gives atomic, ordered durability. It also doubles as the replication stream.',
        },
        {
          q: 'Where do the CLOG update and the proc-array removal sit relative to the flush, and why does that order matter?',
          a: 'After the WAL flush. If other sessions could see the transaction as committed before its commit record was durable, a crash could undo a change that they already acted on. With `synchronous_commit = off`, Postgres knowingly allows exactly this window (≤ 3 × wal_writer_delay).',
        },
      ],
      pitfalls: [
        'Saying the row is written to the table file at commit',
        'Confusing the WAL writer (asynchronous flusher) with the commit-time flush done by the backend',
        'Forgetting full-page images on the first change after a checkpoint',
      ],
    },
    {
      id: 'db-postgres-internals-iq-02',
      difficulty: 'hard',
      question:
        'Our primary was OOM-killed at 02:10 and Postgres took 19 minutes to accept connections again, while the on-call engineer watched the "startup" process burn one core. Explain what it was doing, why it took that long, and give me two independent ways to make the next one shorter.',
      context: '16 vCPU, NVMe, WAL rate ~30 MB/s at that hour; checkpoint_timeout = 30min, max_wal_size = 100GB; an async replica in another AZ.',
      whatInterviewerLooksFor: [
        'Explains crash recovery: replay from the redo point of the last completed checkpoint',
        'Estimates WAL volume from rate × interval and knows the ~1.9 interval worst case',
        'Knows replay is single-process and random-I/O bound on a cold cache',
        'Separates two levers: less WAL to replay (checkpoint tuning) versus not waiting at all (failover)',
      ],
      modelAnswer: `### What the startup process was doing
After an abnormal exit the postmaster reset shared memory and ran **crash recovery**. The startup process read \`pg_control\`, found the last *completed* checkpoint, jumped to its **redo point**, and replayed every WAL record from there, one by one, in a single process. For each record it read the target page (a cold cache, so mostly random reads) and applied the change if \`page LSN < record LSN\`.

### Why 19 minutes
- With \`checkpoint_timeout = 30min\` and 100 GB of WAL allowed, checkpoints are time-driven. A crash just before a checkpoint finishes means replaying the previous interval plus ~90% of the current one: **≈ 1.9 × 30 min × 30 MB/s ≈ 100 GB**. A crash mid-cycle replays less, perhaps 40–60 GB.
- Single-threaded replay on a cold cache runs at roughly 50–150 MB/s. 60 GB ÷ 60 MB/s ≈ 17 min, which matches.
- The OOM kill also means shared buffers start empty, so every page touched by replay is a read.

### Lever 1: replay less WAL
- \`checkpoint_timeout = 10min\` with \`max_wal_size\` sized to keep checkpoints time-driven. The worst case drops to ~1.9 × 10 × 60 × 30 MB ≈ 34 GB, about 6 minutes.
- Cost: more full-page images. Mitigate with \`wal_compression = lz4\`. \`recovery_prefetch\` (PG 15+) issues read-ahead for the blocks that upcoming records reference, which helps on NVMe.

### Lever 2: do not wait for recovery at all
- Use HA (Patroni or a managed service) with a **synchronous** or low-lag standby and automatic failover. Promotion takes seconds, and the old primary rejoins via \`pg_rewind\`. With an *async* replica, failover risks losing the last few hundred ms of commits, so decide the RPO explicitly.

### And fix the trigger
An OOM kill means \`work_mem\` × nodes × backends exceeded RAM. Cap connections behind a pooler, lower the default \`work_mem\`, and set \`vm.overcommit_memory = 2\` so allocations fail cleanly instead of killing the postmaster's children.`,
      followUps: [
        {
          q: 'Why does recovery start at the redo point rather than at the checkpoint record itself?',
          a: 'The checkpoint spent minutes writing dirty buffers while transactions kept running. Pages changed during that window may have been written before or after their change, so the only guaranteed-complete point is the WAL position recorded when the checkpoint began (the redo point). Everything after it must be replayed.',
        },
        {
          q: 'Would doubling shared_buffers make recovery faster?',
          a: 'Only slightly, by letting replay keep more pages cached once they are read. The buffers start empty after a crash anyway, so the first touch of each page is still a disk read. Bigger buffers can also mean a larger dirty set per checkpoint. The dominant factors are WAL volume since the redo point and random-read latency.',
        },
      ],
      pitfalls: [
        'Blaming VACUUM or index rebuilds for startup time',
        'Suggesting fsync = off or full_page_writes = off to speed up writes and recovery',
        'Not noticing that the async replica could have been promoted instead',
      ],
    },
    {
      id: 'db-postgres-internals-iq-03',
      difficulty: 'hard',
      question:
        'Grafana shows write IOPS on our Postgres volume as a saw-tooth: flat for ~40 seconds, then a wall of writes, and API p99 jumps from 30 ms to 400 ms on each wall. Replication bytes per second spike at the same moments. Diagnose it from first principles and tell me what you change.',
      whatInterviewerLooksFor: [
        'Recognises checkpoint-driven I/O bursts and computes the trigger from max_wal_size ÷ WAL rate',
        'Links replication spikes to full-page images after each checkpoint',
        'Uses pg_stat_checkpointer, log_checkpoints and pg_stat_io as evidence',
        'Proposes spreading writes and fewer FPIs, not disabling safety',
      ],
      modelAnswer: `### Hypothesis: WAL-triggered checkpoints
A regular period of ~40 s that is shorter than \`checkpoint_timeout\` (5 min default) points to checkpoints forced by **\`max_wal_size\`**. At 25 MB/s of WAL, the 1 GB default triggers one every ~41 s.

### Evidence I would collect
- The log shows *"checkpoints are occurring too frequently (41 seconds apart)"* and \`checkpoint complete\` lines with large \`wrote N buffers\`.
- \`pg_stat_checkpointer\`: \`num_requested\` far above \`num_timed\`.
- \`pg_stat_wal.wal_fpi\` and \`pg_walinspect\`: WAL rate peaks right after each checkpoint start. That is **full-page images**, because every page's first change after a checkpoint is logged as a whole 8 KB image. The replica receives the same bytes, hence the replication spikes.
- \`pg_stat_io\`: if \`client backend\` writes also spike, queries are evicting dirty pages themselves during the burst.

### Why p99 suffers
Each forced checkpoint must write the whole dirty set and fsync it. The fsync phase flushes the OS dirty cache in one go, so WAL fsyncs (commits) queue behind data writes on the same device. Commit latency jumps, and so does p99.

### Changes
1. \`max_wal_size\` → ~2 × (WAL rate × timeout): 25 MB/s × 900 s ≈ 22 GB, so set ~48 GB with \`checkpoint_timeout = 15min\`. Checkpoints become timed.
2. \`checkpoint_completion_target = 0.9\` spreads the writes over 13.5 min.
3. \`wal_compression = lz4\` cuts FPI bytes (often 2–3× less WAL).
4. Raise \`bgwriter_lru_maxpages\` so backends do not write their own victims. Consider WAL on a separate volume so commit fsyncs do not queue behind data writes.
5. Check the OS: smaller \`vm.dirty_background_bytes\` so the kernel writes back continuously rather than in a burst at fsync.

Trade-off to state: longer intervals mean more WAL to replay after a crash, so I would confirm the RTO is acceptable or covered by HA failover.`,
      followUps: [
        {
          q: 'After the change the saw-tooth is gone, but disk usage of pg_wal grew from 2 GB to 40 GB. Is that a problem?',
          a: 'It is expected. Postgres keeps WAL since the last redo point plus recycled segments up to about max_wal_size. Provision the volume for it, plus headroom for archive lag and replication slots, which can retain WAL beyond max_wal_size. Alert on pg_wal usage and on slots whose restart_lsn stops moving, not on the size itself.',
        },
        {
          q: 'Could the spikes come from autovacuum rather than checkpoints? How would you tell them apart?',
          a: 'Autovacuum I/O follows table activity and lasts as long as the vacuum. It shows up as autovacuum worker reads and writes in pg_stat_io and in pg_stat_progress_vacuum. Its rhythm will not line up with checkpoint log lines and will not show the post-checkpoint FPI signature in WAL. Correlate the timestamps of the checkpoint start and complete log lines with the IOPS walls.',
        },
      ],
      pitfalls: [
        'Lowering checkpoint_timeout to "make each checkpoint smaller", which only multiplies FPIs',
        'Turning off full_page_writes to reduce replication traffic',
        'Throwing more IOPS at it without explaining the mechanism',
      ],
    },
    {
      id: 'db-postgres-internals-iq-04',
      difficulty: 'hard',
      question:
        'A colleague wants to set shared_buffers to 75% of RAM on our new 128 GB database server, arguing that "Postgres cache hits are faster than OS cache hits". Make the case for and against, and tell me what you would actually configure and how you would validate it.',
      whatInterviewerLooksFor: [
        'Explains double buffering through the OS page cache',
        'Knows clock-sweep costs and that checkpoint dirty-set size grows with the pool',
        'Considers memory for work_mem, maintenance and backends, plus huge pages',
        'Proposes measurement: pg_buffercache, hit ratios, pg_stat_io, latency under load',
      ],
      modelAnswer: `### What is true in the colleague's argument
A hit in shared buffers avoids a syscall and a copy from the OS cache, which saves microseconds per page. For a working set that fits in the pool but not in a smaller one, a bigger pool can reduce reads. Some workloads (large, read-mostly hot sets) do benefit from 40–50%.

### Why 75% is usually wrong
- **Double buffering.** Postgres does buffered I/O, so most pages in shared buffers are also in the OS page cache. At 96 GB of pool, the OS cache is squeezed into what is left after backends, so the *effective* cache does not grow much. Pages evicted from the pool now miss in the OS cache too.
- **Everything else needs RAM.** \`work_mem\` per sort/hash node × concurrency, \`maintenance_work_mem\` × autovacuum workers, backend catalog caches, the pooler. At 75%, one heavy report can trigger the OOM killer, and a backend kill restarts the whole cluster.
- **Checkpoints and dirty pages.** A larger pool can hold more dirty pages, so each checkpoint has more to write and fsync. Bursts grow unless the bgwriter and checkpoint spreading keep up.
- **Clock-sweep.** A larger pool means a longer sweep to find a victim when most buffers have high usage counts. This is rarely dominant, but it is real for write-heavy churn.

### What I would configure
- Start at **25–40%**: \`shared_buffers = 32GB\` (up to ~48 GB for a read-heavy hot set), \`huge_pages = on\` (needs \`vm.nr_hugepages\` sized for it), \`effective_cache_size = 96GB\` (a planner hint only).
- Keep \`work_mem\` modest with a pooler capping active backends.

### How I would validate it
- \`pg_buffercache\`: is the hot set resident, and what is the usagecount distribution?
- \`pg_stat_io\` reads and hits per relation, and \`blks_read\` versus \`blks_hit\` in \`pg_stat_database\`, plus OS-level read IOPS (a miss in shared buffers may still be an OS hit).
- A/B test 32 GB versus 64 GB on a replay of production traffic (pgbench with a custom script or pgreplay), comparing p99 and checkpoint behaviour, not just the hit ratio.`,
      followUps: [
        {
          q: 'Would direct I/O change this advice?',
          a: 'Yes. Without the OS cache, the shared pool is the only cache, so you would size it much larger (60–75%). PostgreSQL has only a developer-oriented `debug_io_direct` setting; it is not a production feature in PG 18. PG 18 AIO (io_method) improves read-ahead but still goes through the page cache with the worker method, so the 25–40% guidance holds today.',
        },
        {
          q: 'Your cache hit ratio is 99.2% but p99 reads are still slow. What do you look at next?',
          a: 'The hit ratio counts shared-buffer hits only and is averaged over all queries. Look at per-query `shared read` in EXPLAIN (ANALYZE, BUFFERS) and pg_stat_statements `shared_blks_read` for the slow queries, and at OS cache misses (actual device read IOPS and latency). Also check for lock or I/O waits in pg_stat_activity. A 0.8% miss rate on a hot path can be thousands of random reads per second.',
        },
      ],
      pitfalls: [
        'Quoting "25%" without explaining why',
        'Treating the buffer-cache hit ratio as proof of good performance',
        'Ignoring the memory needed by work_mem and backends',
      ],
    },
    {
      id: 'db-postgres-internals-iq-05',
      difficulty: 'hard',
      question:
        'Our `user_profiles` table has a `settings jsonb` column averaging 45 KB. Product added a `profile_views` counter inside that JSON and now increments it on every profile view (~3K/s). WAL volume tripled, replicas lag, and the table plus its TOAST table grew 5× in a month. Explain the mechanism and redesign it.',
      whatInterviewerLooksFor: [
        'Explains TOAST: compression, out-of-line chunks, 18-byte pointer',
        'Knows that updating any part of a jsonb value writes a whole new value and leaves the old chunks dead',
        'Quantifies WAL per increment and connects dead chunks to vacuum and bloat',
        'Redesigns with a narrow column or table, HOT updates, or aggregated counters',
      ],
      modelAnswer: `### Mechanism
- A 45 KB jsonb is above the ~2 KB TOAST threshold. It is compressed (pglz by default) and, if still large, stored **out of line** in \`pg_toast_<oid>\` as ~2,000-byte chunks. The heap row keeps an 18-byte pointer.
- jsonb is a **single value**. \`jsonb_set(settings, '{profile_views}', …)\` detoasts the whole document, modifies it in memory, then compresses and stores a **brand-new TOAST value**: say 15 KB compressed ≈ 8 chunks, each a new TOAST tuple plus a TOAST-index entry, all WAL-logged. A new heap tuple version is written too.
- The old version's chunks become **dead tuples** in the TOAST table. At 3K updates/s, that is ~24K dead chunk rows per second. Autovacuum cannot keep up, so the TOAST table bloats.
- WAL: ~15 KB+ per increment × 3,000/s ≈ **45 MB/s** of extra WAL, plus FPIs. Replicas must replay all of it single-threaded, hence the lag.

### Redesign
1. **Move the counter out of the document.** \`profile_stats(user_id PK, views bigint)\` as a narrow table with \`fillfactor = 80\`. An increment is now a ~40-byte tuple change, usually **HOT** (no index on \`views\`), with ~100 bytes of WAL. That is a ~150× reduction.
2. **Even better, do not write per view.** Increment in Redis (\`INCRBY\`) or aggregate in the app for 5–10 s, then flush \`UPDATE … SET views = views + $n\` in batches. 3K/s becomes a few hundred row updates per flush, sorted by key to avoid deadlocks.
3. **Clean up.** After the migration, \`VACUUM\` the TOAST table. To return space to the OS, use \`pg_repack\` (online) rather than \`VACUUM FULL\` (an exclusive lock).
4. **Guardrails.** \`SET COMPRESSION lz4\` on \`settings\` for cheaper (de)compression. Review all ORM code that does read-modify-write of the whole document. Only touch \`settings\` when the settings actually change.

### Principle to state
In Postgres, the unit of write is the whole value (and the whole row version). Separate data by **change frequency**: hot, small fields in narrow columns or tables; cold, big blobs in TOAST.`,
      followUps: [
        {
          q: 'Would switching settings from jsonb to json or text help?',
          a: 'No. All of them are single varlena values with the same TOAST behaviour: any change rewrites the whole value. json would also lose binary parsing and GIN indexing. The fix is to separate by change frequency, not to change the type.',
        },
        {
          q: 'Why do unchanged columns not cost anything in the new design, even though Postgres writes a whole new tuple version on UPDATE?',
          a: 'The new heap tuple copies the 18-byte TOAST pointer of an unchanged out-of-line value instead of rewriting its chunks, so the big blob is shared by both versions. Only inline columns are physically copied. In the narrow `profile_stats` table there is no blob at all, and HOT keeps index entries untouched.',
        },
      ],
      pitfalls: [
        'Thinking jsonb supports in-place partial updates on disk',
        'Blaming autovacuum settings alone without fixing the write pattern',
        'Recommending VACUUM FULL on a hot production table',
      ],
    },
    {
      id: 'db-postgres-internals-iq-06',
      difficulty: 'expert',
      question:
        'We bulk-loaded 300M rows into a new partition at night with COPY. At 9 AM the first analytics query on it took 40 minutes instead of the expected 6, the primary generated ~70 GB of WAL during that query, and the replicas fell 20 minutes behind. Nobody wrote anything. What happened?',
      context: 'PostgreSQL 18 cluster created with default initdb settings; the analytics query is a sequential scan with aggregation.',
      whatInterviewerLooksFor: [
        'Identifies hint bits being set by the first reader, and the CLOG lookups that this involves',
        'Connects data checksums (default on in PG 18) to full-page images for hint-bit changes',
        'Explains the dirtied pages, checkpoint writes and replica replay',
        'Fixes it with VACUUM (ANALYZE or FREEZE) in the load window, plus COPY FREEZE where applicable',
      ],
      modelAnswer: `### What happened
1. **Tuples without hint bits.** COPY writes tuples with \`xmin\` = the loading transaction, but nobody has yet recorded "that transaction committed" *on the tuples*.
2. **The first reader sets them.** For every tuple, the scan must decide if \`xmin\` committed. Without \`HEAP_XMIN_COMMITTED\` set, it checks the snapshot and the CLOG, then **sets the hint bit**. Setting a hint bit **dirties the page**, so all ~3–4M pages of the partition became dirty.
3. **Checksums turn hints into WAL.** PG 18's \`initdb\` enables **data checksums by default**. With checksums, a hint-bit change after a checkpoint must be protected against torn writes, so the first such change to each page emits a **full-page image**. Roughly 4M pages × 8 KB ≈ 30+ GB, plus repeats when a checkpoint occurs mid-scan and pages get FPI'd again, explains ~70 GB of WAL.
4. **Consequences.** The "read-only" query had to write WAL (flushes) and evict dirty pages, so its duration grew several times over. The checkpointer then rewrote the whole partition. The replicas had to replay 70 GB of FPIs (single-threaded), hence 20 minutes of lag.

### Fix
- In the **load window**, right after COPY: \`VACUUM (ANALYZE)\`, or \`VACUUM (FREEZE, ANALYZE)\` for immutable history. This sets hint bits, all-visible and all-frozen bits in the visibility map, and statistics. The cost is paid at night, at a controlled rate (cost-based delay), before replicas serve traffic.
- Better still: \`COPY … WITH (FREEZE)\` into a table or partition **created or truncated in the same transaction**. The rows are written already frozen, so no later hint-bit or freeze pass is needed.
- Load with \`wal_compression = lz4\` enabled to shrink whatever FPIs remain.
- Monitor with \`EXPLAIN (ANALYZE, BUFFERS, WAL)\` on a sample query after the load: \`dirtied\` and \`fpi\` should be ~0.

### Bonus
Without the VACUUM, the visibility map is empty, so index-only scans on that partition would visit the heap for every row too.`,
      followUps: [
        {
          q: 'Should we just disable data checksums to avoid this?',
          a: 'No. Checksums detect silent storage corruption, which is worth far more than this one-time cost. Remove the cost by doing the vacuum or freeze pass in the load window, or by using COPY FREEZE. In PG 18 the cost is the FPI per page on the first hint-bit change after each checkpoint; without checksums it would still dirty every page.',
        },
        {
          q: 'Why would the same query be fast on the second run?',
          a: 'The hint bits (and possibly all-visible bits, if vacuum ran) are now set. Visibility checks no longer touch CLOG, no page gets dirtied, and no WAL is produced. The query becomes a pure read, limited by sequential I/O and CPU.',
        },
      ],
      pitfalls: [
        'Assuming SELECT can never write',
        'Blaming the replicas or the network rather than WAL volume',
        'Suggesting a bigger shared_buffers as the fix',
      ],
    },
    {
      id: 'db-postgres-internals-iq-07',
      difficulty: 'medium',
      question:
        'Rapid-fire: our architecture review wants to set synchronous_commit = off cluster-wide "because we have replicas anyway". In two minutes, tell me what failure this exposes us to, how big the window is, how it differs from fsync = off, and what you would do instead.',
      whatInterviewerLooksFor: [
        'Window ≤ 3 × wal_writer_delay (600 ms) of acknowledged commits lost on an OS crash or power loss',
        'No corruption, unlike fsync = off',
        'Recognises that replicas do not help: async WAL that was never flushed never reached them either',
        'Scopes it per transaction with SET LOCAL for re-derivable data',
      ],
      modelAnswer: `**The exposure:** with \`off\`, COMMIT returns before the WAL is flushed. The WAL writer flushes within at most **3 × \`wal_writer_delay\` = 600 ms** by default. A Postgres-only crash is fine (WAL in the OS cache still gets written), but an **OS crash, power loss or instance termination** loses up to ~600 ms of commits that clients were told succeeded. Other sessions may already have *read* those rows and acted on them.

**"We have replicas" does not help:** WAL is streamed after it is written locally. Commits that were not yet flushed when the primary died are usually not on the replicas either, and failover promotes a replica that never saw them.

**Versus fsync = off:** \`synchronous_commit = off\` keeps WAL ordered, so recovery is always **consistent**: you lose a tail, never integrity. \`fsync = off\` lets the OS reorder or skip writes, so a crash can leave a **corrupt cluster** that may not start. One is a bounded loss; the other is a restore from backup.

**What I would do instead:** keep the default \`on\` and opt specific write classes out with \`SET LOCAL synchronous_commit = off\` inside their transactions: analytics events, \`last_seen_at\`, or anything replayable from Kafka. Batch writes so commit cost is amortised. Never use a session-level \`SET\` on a pooled connection.`,
      followUps: [
        {
          q: 'Is there any workload where cluster-wide off is acceptable?',
          a: 'Yes: a derived store whose whole content can be rebuilt (a reporting replica fed by ETL, a cache-like table rebuilt from an event log, a CI database). Document the RPO (≈ 600 ms of acks) and make sure no money or user-visible state of record lives there.',
        },
        {
          q: 'What does commit_delay do, and would it be a better alternative here?',
          a: '`commit_delay` makes a committing backend wait some microseconds before flushing, if at least `commit_siblings` (5) transactions are active, so more commits share one fsync. It keeps full durability but adds latency to each commit. It helps only on slow-fsync storage with many concurrent writers; batching in the app is usually more effective.',
        },
      ],
      pitfalls: [
        'Claiming synchronous_commit = off can corrupt the database',
        'Assuming replicas protect async commits',
        'Using session-level SET on pooled connections',
      ],
    },
    {
      id: 'db-postgres-internals-iq-08',
      difficulty: 'hard',
      question:
        'An analyst runs a nightly full scan of our 400 GB `orders` table on the primary (shared_buffers = 32 GB) and claims it is "harmless because Postgres protects the cache". Meanwhile, a weekly job runs `UPDATE orders_archive SET migrated = true` over a 7 GB table, and after it the OLTP hit ratio drops for an hour. Explain both behaviours from the buffer manager\'s point of view.',
      whatInterviewerLooksFor: [
        'Knows the clock-sweep and usage_count mechanics',
        'Knows ring buffers: 256 KB for seq scans over 1/4 of shared_buffers',
        'Explains why a 7 GB table (< 8 GB = 1/4 of 32 GB) does not get a ring, and why dirtying updates escape rings',
        'Mentions OS page cache effects and running analytics on a replica',
      ],
      modelAnswer: `### The 400 GB scan: mostly harmless to shared buffers
- A sequential scan of a table larger than **¼ of shared_buffers** (8 GB here) uses a **BULKREAD ring of 256 KB**. It keeps recycling the same ~32 buffers instead of pulling new victims from the clock, so the OLTP pages keep their usage counts and stay resident.
- It is **not** harmless overall. It reads 400 GB through the **OS page cache**, which evicts OS-cached pages that back shared-buffer misses. It competes for disk bandwidth, holds a snapshot for the whole scan (holding back vacuum's xmin horizon, which causes bloat elsewhere), and uses CPU. It belongs on a replica or in a warehouse.

### The 7 GB UPDATE: why it hurts
- **No ring.** 7 GB is below the 8 GB threshold, so the scan part uses the normal strategy. Every page goes through clock-sweep and starts with a non-zero usage count.
- **Dirtying escapes rings anyway.** Even for bigger tables, a buffer that gets dirtied with a new WAL LSN is dropped from the ring and replaced through the normal path, so a full-table UPDATE effectively uses the main pool.
- The UPDATE writes **new tuple versions** (another ~7 GB of pages if not HOT), WAL with full-page images for every first touch, and index entries. The OLTP pages see their usage counts decremented by a hand sweeping fast. Many reach 0 and are evicted, so the hot set must be re-read afterwards: the hour-long hit-ratio dip.
- It also leaves ~7 GB of dead tuples for vacuum, and a checkpoint storm.

### Fixes
- Run the UPDATE in **batches** (e.g. 10K rows by primary-key range, short transactions, with a sleep in between), or better, avoid it: write \`migrated\` as part of the archive process, or create a new table with \`CREATE TABLE … AS\` (a 16 MB bulk-write ring) and swap.
- Run analytics on a replica (\`hot_standby_feedback\` trade-offs apply) or with CDC to a warehouse.
- Track the effect with \`pg_buffercache\` usagecount histograms before and after.`,
      followUps: [
        {
          q: 'Would VACUUM of the 400 GB table thrash the cache?',
          a: 'Not shared buffers. VACUUM uses its own ring sized by `vacuum_buffer_usage_limit` (2 MB default since PG 17, capped at 1/8 of shared_buffers). It still reads through the OS cache and generates I/O and WAL. You can raise the limit for a faster manual VACUUM in a maintenance window; `0` means no ring limit.',
        },
        {
          q: 'Why does Postgres cap usage_count at 5 instead of counting every hit?',
          a: 'Without a cap, a page hit a million times in a burst would stay resident for a million passes of the clock hand, long after it went cold. Capping at 5 means any page is evictable within five passes of being unused, which approximates LRU while staying cheap: no global list and no lock on every hit.',
        },
      ],
      pitfalls: [
        'Believing Postgres uses a true LRU list',
        'Saying a sequential scan always evicts the whole cache',
        'Ignoring the OS page cache entirely',
      ],
    },
    {
      id: 'db-postgres-internals-iq-09',
      difficulty: 'expert',
      question:
        'The storage team says our new cloud volume guarantees atomic 16 KB writes and proposes turning off full_page_writes to cut WAL by 60%. What exactly does full_page_writes protect against, what evidence would you require before agreeing, and what else breaks or changes if you turn it off?',
      whatInterviewerLooksFor: [
        'Explains torn pages and why row-level WAL cannot repair them',
        'Requires documented atomicity end to end (the filesystem, not just the device)',
        'Knows base backups and pg_rewind still rely on FPIs, and the checksum and hint-bit interplay',
        'Offers the safer alternatives (longer checkpoints, wal_compression) and a measured rollout',
      ],
      modelAnswer: `### What it protects against
A Postgres page is 8 KB. If a crash interrupts the write of a data page, the on-disk page can be **torn**: part new, part old. WAL records describe *deltas* ("insert tuple at offset X"), so replaying them onto a torn page produces garbage. With \`full_page_writes = on\`, the first change to each page after a checkpoint logs the whole page. Recovery restores that image and then applies the deltas, so the on-disk state of the page no longer matters.

### Evidence I would require
- **End-to-end atomicity:** the device guarantees 16 KB atomic writes, *and* the filesystem issues aligned 8 KB writes that it never splits. Typically that means ext4 or xfs with matching block size and alignment, and documented support (some clouds document "torn write prevention" with specific configurations). An atomic device write does not help if the filesystem splits the page.
- **Failure testing:** crash-consistency tests (power-cut simulation, killing the instance mid-write) with checksums on and \`pg_amcheck\` afterwards. One clean run proves little, so run many.
- **Vendor support statement** covering snapshots and replication of that volume.

### What changes if it is off
- \`pg_basebackup\` still forces FPIs during the backup. Backups are torn by nature, so it requires FPI protection while running.
- \`pg_rewind\` requires \`wal_log_hints = on\` or data checksums. With checksums on, hint-bit FPIs are still written.
- Torn writes would show up as **checksum failures** but could not be repaired. The fallback is a restore or a replica rebuild.

### My recommendation
First take the cheap 60%: \`wal_compression = lz4\`, and \`checkpoint_timeout\` 15–30 min with a large \`max_wal_size\`. That often removes most of the FPI volume with zero risk. If WAL is still a bottleneck, pilot \`full_page_writes = off\` on one replica's promotion path (or on a non-critical cluster) with the evidence above, and with checksums plus regular \`pg_amcheck\`.`,
      followUps: [
        {
          q: 'On ZFS people routinely run with full_page_writes = off. Why is that considered safe there?',
          a: 'ZFS is copy-on-write: it never overwrites a block in place. A new version is written elsewhere and the pointer is switched atomically, so a crash leaves either the complete old page or the complete new one, never a mix. The torn-page failure mode cannot occur as long as recordsize is at least 8 KB, so the full-page images are pure overhead.',
        },
        {
          q: 'How would you measure how much of your WAL is full-page images today?',
          a: 'Compare deltas of `pg_stat_wal.wal_fpi` and `wal_bytes` over an hour. Or run `pg_walinspect.pg_get_wal_stats(start, end, per_record => true)` and sum `fpi_size` against total record size, or use `pg_waldump --stats=record`. Sample right after a checkpoint and in the middle of a cycle to see the decay.',
        },
      ],
      pitfalls: [
        'Thinking checksums repair torn pages (they only detect them)',
        'Trusting a device-level guarantee without checking filesystem alignment',
        'Not trying wal_compression and longer checkpoints first',
      ],
    },
  ],
  envelopeQuestions: [
    {
      id: 'db-postgres-internals-boe-1',
      question:
        'Estimate the on-disk heap size and primary-key index size of a 500M-row `ledger_entries` table with columns (id bigint, account_id bigint, amount int, kind smallint, created_at timestamptz), no NULLs, freshly loaded with no dead tuples. How much of the size is overhead rather than your data?',
      assumptions: [
        '8 KB pages (8,192 bytes), 24-byte page header, heap fillfactor 100',
        'Tuple header 23 bytes → t_hoff = 24 (MAXALIGN 8, no null bitmap)',
        'Column alignment: bigint and timestamptz 8, int 4, smallint 2',
        '4-byte line pointer per tuple',
        'B-tree leaf: 8-byte index tuple header + 8-byte key, 4-byte line pointer, 16-byte special space, leaf fillfactor 90%',
      ],
      steps: [
        { label: 'Data bytes with alignment', calc: 'id 0–8, account_id 8–16, amount 16–20, kind 20–22, pad 2 → created_at 24–32 ⇒ 32 bytes (30 bytes of real data + 2 padding)' },
        { label: 'Tuple size', calc: '24 header + 32 data = 56 bytes (already a multiple of 8)' },
        { label: 'Per-row cost on page', calc: '56 + 4 line pointer = 60 bytes' },
        { label: 'Rows per page', calc: '(8,192 − 24) ÷ 60 = 8,168 ÷ 60 ≈ 136 rows' },
        { label: 'Heap pages and size', calc: '500M ÷ 136 ≈ 3.68M pages × 8,192 B ≈ 30.1 GB' },
        { label: 'Raw data', calc: '500M × 30 B = 15 GB ⇒ heap is ~2× the raw data' },
        { label: 'PK index entries per leaf', calc: '(8,192 − 24 − 16) × 0.9 ÷ (16 + 4) = 7,337 ÷ 20 ≈ 366' },
        { label: 'PK index size', calc: '500M ÷ 366 ≈ 1.37M leaf pages × 8 KB ≈ 11.2 GB (inner pages add <1%)' },
      ],
      answer:
        '≈ 30 GB heap + ≈ 11 GB primary key ≈ 41 GB for 15 GB of actual values. About 28 bytes per row (24 header + 4 line pointer) is pure overhead, almost as much as the 30 bytes of data.',
      insight:
        'For narrow, high-row-count tables the per-tuple overhead, not your columns, dominates storage and buffer-cache footprint. That pushes you toward fewer, wider rows (e.g. daily aggregates), dropping redundant indexes, BRIN instead of B-tree on append-only time columns, or partition-level archiving to columnar storage. Column ordering helps only when padding is wasted; here it already is not.',
      followUps: [
        {
          q: 'A teammate adds a nullable `note text` column that is NULL in 99% of rows. What happens to the size?',
          a: 'For rows where it is NULL, the tuple gets a null bitmap (1 bit per column, 6 bits here → 1 byte). That fits inside the 24-byte header area (23 + 1 = 24), so t_hoff stays 24 and the NULL costs nothing. For the 1% with notes, the value is stored inline (short varlena header plus text) or TOASTed if large. The size grows only by roughly 1% × the average note size.',
        },
        {
          q: 'After a month of updates to `kind`, the table is 45 GB. Where did the extra 15 GB come from, and how would you confirm it?',
          a: 'Every UPDATE writes a new 56-byte tuple version, and dead versions take space until vacuum marks them reusable. Free space inside pages is not returned to the OS. `pgstattuple(\'ledger_entries\')` shows dead_tuple_percent and free_percent. If free space is high but dead tuples are low, vacuum is working and the table has steady-state slack. Lowering fillfactor (e.g. 90) makes those updates HOT so they reuse in-page space.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-boe-2',
      question:
        'An OLTP table has 2M hot pages (16 GB). Writes arrive at 5,000 row updates/s, spread uniformly at random across those pages, each producing a ~150-byte WAL record. Estimate the WAL rate from full-page images with checkpoint_timeout = 5 min versus 30 min, and compare it with the record WAL.',
      assumptions: [
        'full_page_writes = on, no wal_compression; an FPI costs ~8 KB (pages are full, so no hole)',
        'Checkpoints are time-driven (max_wal_size is large enough)',
        'Distinct pages touched by k random updates over N pages ≈ N × (1 − e^(−k/N))',
        'Each page gets one FPI per checkpoint cycle (its first change)',
      ],
      steps: [
        { label: 'Record WAL (independent of checkpoints)', calc: '5,000/s × 150 B = 0.75 MB/s' },
        { label: '5-min cycle: updates per cycle', calc: 'k = 5,000 × 300 = 1.5M; k/N = 1.5M ÷ 2M = 0.75' },
        { label: '5-min: distinct pages touched', calc: '2M × (1 − e^−0.75) = 2M × (1 − 0.472) ≈ 1.055M pages' },
        { label: '5-min: FPI bytes and rate', calc: '1.055M × 8,192 B ≈ 8.6 GB per 300 s ≈ 28.8 MB/s' },
        { label: '30-min cycle: updates per cycle', calc: 'k = 5,000 × 1,800 = 9M; k/N = 4.5' },
        { label: '30-min: distinct pages touched', calc: '2M × (1 − e^−4.5) = 2M × (1 − 0.011) ≈ 1.978M pages' },
        { label: '30-min: FPI bytes and rate', calc: '1.978M × 8,192 B ≈ 16.2 GB per 1,800 s ≈ 9.0 MB/s' },
        { label: 'Compare', calc: '5 min: ~29.5 MB/s total (FPI ≈ 97%); 30 min: ~9.8 MB/s total ⇒ ~3× less WAL' },
      ],
      answer:
        'About 29 MB/s of full-page images at 5-minute checkpoints versus about 9 MB/s at 30 minutes, against only 0.75 MB/s of actual change records. FPIs are more than 90% of WAL either way.',
      insight:
        'With random updates over a large hot set, WAL volume (and therefore replica bandwidth, archive storage and replay time) is driven by checkpoint frequency, not by how much data changes. Lengthening the cycle and adding `wal_compression = lz4` are the main levers. The price is longer crash recovery (≈ 1.9 × 30 min of WAL in the worst case), which HA failover usually covers.',
      followUps: [
        {
          q: 'What if the updates are not uniform: 90% of them hit a 100K-page hot set?',
          a: 'The hot set saturates fast: 4,500/s × 300 s = 1.35M updates over 100K pages ⇒ essentially all 100K pages get one FPI per cycle ≈ 0.8 GB/5 min ≈ 2.7 MB/s. The remaining 500/s over 1.9M pages: k = 150K, ≈ 144K distinct pages ≈ 1.2 GB ≈ 3.9 MB/s. Total ≈ 6.6 MB/s instead of 29. Skew reduces FPI volume because repeat touches inside a cycle are free.',
        },
        {
          q: 'With lz4 wal_compression, roughly what changes in the 5-minute case?',
          a: 'Only the FPIs are compressed. Typical OLTP pages compress 2–4×, so assume 3×: 28.8 ÷ 3 ≈ 9.6 MB/s of FPI + 0.75 MB/s of records ≈ 10.4 MB/s, close to the uncompressed 30-minute case, for a few percent extra CPU on the primary and on replay. Combining both (30 min + lz4) gives ≈ 3 + 0.75 ≈ 3.8 MB/s.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-boe-3',
      question:
        'A primary generates 40 MB/s of WAL with checkpoint_timeout = 15 min, checkpoint_completion_target = 0.9 and a large max_wal_size. Single-threaded replay on this hardware runs at ~150 MB/s from a cold cache. Estimate worst-case and average crash-recovery time, and the checkpoint interval needed for a 3-minute worst case.',
      assumptions: [
        'Checkpoints are time-driven and start every 900 s; each completes 0.9 × 900 = 810 s after it starts',
        'Recovery replays from the redo point (start) of the last completed checkpoint',
        'Crash time is uniformly distributed; replay speed is constant',
      ],
      steps: [
        { label: 'Worst case: WAL since redo', calc: 'Crash just before a checkpoint completes: 900 s + 810 s = 1,710 s × 40 MB/s ≈ 68.4 GB' },
        { label: 'Worst-case recovery', calc: '68.4 GB ÷ 150 MB/s ≈ 456 s ≈ 7.6 min' },
        { label: 'Best case', calc: 'Right after a checkpoint completes: 810 s × 40 MB/s ≈ 32.4 GB ÷ 150 ≈ 216 s ≈ 3.6 min' },
        { label: 'Average', calc: 'Uniform between 0.9T and 1.9T ⇒ mean 1.4T = 1,260 s × 40 MB/s ≈ 50.4 GB ÷ 150 ≈ 336 s ≈ 5.6 min' },
        { label: 'Target 3-min worst case', calc: '180 s × 150 MB/s = 27 GB budget ⇒ 27 GB ÷ 40 MB/s = 675 s = 1.9T ⇒ T ≈ 355 s ≈ 6 min' },
        { label: 'max_wal_size for that', calc: 'WAL per cycle ≈ 40 MB/s × 355 s ≈ 14 GB; set ~28 GB (2×) so checkpoints stay time-driven' },
      ],
      answer:
        'Worst case ≈ 7.6 minutes, average ≈ 5.6 minutes. A 3-minute worst case needs checkpoint_timeout ≈ 6 min (max_wal_size ~28 GB), at the price of roughly 2× more full-page-image WAL.',
      insight:
        'Recovery time is a direct function of the checkpoint interval and the WAL rate, so RTO and WAL volume pull in opposite directions. If you already run a synchronous or low-lag standby with automatic failover, the database RTO is set by promotion (seconds), and you can keep long checkpoints for lower WAL. Choose explicitly.',
      followUps: [
        {
          q: 'Peak WAL is 3× the average for a 20-minute batch window every night. What breaks first?',
          a: 'At 120 MB/s, a 15-min cycle produces ~108 GB. If max_wal_size is below that, checkpoints become WAL-triggered (more FPIs, more WAL). A crash during the batch replays up to 1.9 × 900 × 120 MB ≈ 205 GB, about 23 min at 150 MB/s. Replicas may also lag, since replay is single-threaded. Size max_wal_size for peak, and accept or mitigate the night-time RTO with failover.',
        },
        {
          q: 'Recovery measured in a drill was 2× slower than your estimate. What do you suspect?',
          a: 'Replay is bound by random reads of the pages that records touch. A cold cache, network storage with ~1 ms reads and many distinct pages make it slower than sequential WAL reading suggests. Check `recovery_prefetch` (on by default where supported in PG 15+, it needs effective_io_concurrency > 0), the WAL volume (more FPIs than assumed), and whether fsyncs at the end-of-recovery checkpoint added time.',
        },
      ],
    },
  ],
  test: [
    {
      id: 'db-postgres-internals-mcq-01',
      difficulty: 'medium',
      question:
        'You inspect block 0 of a small table with pageinspect right after some activity. What is the most accurate reading of this output?',
      code: {
        language: 'text',
        title: 'heap_page_items(get_raw_page(\'acct\', 0))',
        code: ` lp | t_xmin | t_xmax | t_ctid
----+--------+--------+--------
  1 |   8100 |   8104 | (0,4)
  2 |   8100 |      0 | (0,2)
  3 |   8101 |   8101 | (0,3)
  4 |   8104 |      0 | (0,4)`,
      },
      options: [
        'Tuple 1 was updated by xid 8104 and its new version is at line pointer 4; tuple 3 was inserted and then deleted by the same transaction 8101',
        'Tuple 1 was deleted by 8104 and tuple 4 is an unrelated insert; ctid only ever points to the tuple itself',
        'Tuple 2 is dead because its xmax is 0, and vacuum will remove it on the next run',
        'Tuple 4 must be invisible to everyone because xid 8104 also appears in the xmax of another tuple',
      ],
      correct: [0],
      explanation:
        'After an UPDATE, the old version gets xmax = updating xid and its t_ctid points at the successor, here (0,4), whose xmin is the same 8104. Tuple 3 has xmin = xmax = 8101: inserted and then deleted within one transaction (whether that is visible depends on whether 8101 committed). ctid points to itself only for the latest version, xmax = 0 means live rather than dead, and sharing an xid across xmax and xmin is exactly what an update looks like.',
      followUps: [
        {
          q: 'How would you tell whether the update from tuple 1 to tuple 4 was a HOT update?',
          a: 'Look at the infomask2 flags: the old tuple would have HEAP_HOT_UPDATED and the new one HEAP_ONLY_TUPLE (`heap_tuple_infomask_flags(t_infomask, t_infomask2)` decodes them). Equivalently, the index would still point only at (0,1). A HOT chain needs the new version on the same page with no indexed column changed.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-02',
      difficulty: 'hard',
      question:
        'A reference-data page was hit 40,000 times during a 2-minute burst, then never touched again. Under PostgreSQL\'s clock-sweep, what bounds how long it can stay in shared buffers after the burst (assuming no one pins it)?',
      options: [
        'It survives roughly 40,000 passes of the clock hand, because usage_count records every hit',
        'It is evicted on the very next pass, because clock-sweep only checks whether the reference bit is set',
        'It stays until the next checkpoint, because the checkpointer evicts clean pages after writing',
        'It survives at most about 5 passes of the clock hand, because usage_count is capped at 5 and each pass decrements it by 1',
      ],
      correct: [3],
      explanation:
        'Each pin increments usage_count up to BM_MAX_USAGE_COUNT = 5. The hand decrements a non-zero count on each pass and evicts an unpinned buffer at 0, so after five passes without use the page is a victim. Hit counts are not accumulated without bound, checkpoints write dirty pages but do not evict, and Postgres uses a counter, not the single reference bit of the classic CLOCK algorithm.',
      followUps: [
        {
          q: 'How quickly does a "pass" happen in practice?',
          a: 'It depends on the miss rate. The hand only moves when a backend needs a free buffer. With 2M buffers (16 GB) and 20,000 misses/s, a full pass takes ~100 s, so a cold page may survive ~8 minutes (5 passes). With a mostly resident working set and few misses, cold pages can linger for hours, which is harmless.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-03',
      difficulty: 'hard',
      question:
        'A single-node primary (no sync standbys, synchronous_commit = on) has just returned COMMIT for a transaction that updated one row. Select ALL statements that are guaranteed to be true at that instant.',
      options: [
        'The WAL up to and including the commit record has been flushed (fdatasync) to the WAL device',
        'The modified heap page has been written to its data file',
        'The transaction is marked committed in CLOG, at least in its shared-memory buffer',
        'The new tuple already has the HEAP_XMIN_COMMITTED hint bit set',
        'A checkpoint must happen before the change can be replicated to a streaming standby',
      ],
      correct: [0, 2],
      explanation:
        'COMMIT waits for the WAL flush of the commit record, and the CLOG is updated (in SLRU buffers) before the transaction leaves the proc array. The heap page is typically still dirty in shared buffers, and is written later by the bgwriter, checkpointer or an evicting backend. Hint bits are set later by a reader or by vacuum. Replication streams WAL continuously, independent of checkpoints.',
      followUps: [
        {
          q: 'If a crash happens now, how does the change get into the data file?',
          a: 'Crash recovery replays WAL from the last completed checkpoint\'s redo point. When it reaches this transaction\'s heap record, it sees page LSN < record LSN on the old page (or restores the FPI) and applies the change. The commit record then marks the xid committed in CLOG. The page is written later, normally by the end-of-recovery checkpoint.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-04',
      difficulty: 'expert',
      question:
        'To cut WAL, a team ran with full_page_writes = off on ext4 (4 KB blocks) over a regular cloud block device. A power loss interrupted the write of an 8 KB heap page, leaving its first 4 KB new and its second 4 KB old. Data checksums are off. What happens on restart?',
      options: [
        'Recovery replays delta records onto the half-old, half-new page; the result can be silently corrupt rows or line pointers, possibly detected only much later',
        'Crash recovery detects the torn page via pd_lsn and re-fetches the page from the WAL archive automatically',
        'Postgres refuses to start because the page header LSN does not match the control file',
        'Nothing bad: since the WAL is intact, replaying all records from the redo point always rebuilds the page exactly',
      ],
      correct: [0],
      explanation:
        'Without a full-page image, the only thing recovery has is delta records, which assume the page started in a valid state. pd_lsn lives in the first part of the page, so it may look new while the rest is stale, and recovery may even skip records it thinks are already applied. Nothing re-fetches pages from the archive, and startup has no per-page check against the control file. With checksums the damage would at least be detected on read, but not repaired.',
      followUps: [
        {
          q: 'Would turning checksums on make full_page_writes = off safe?',
          a: 'No. Checksums turn silent corruption into a loud error (`invalid page in block`). You would know the page is broken, but recovery still cannot rebuild it, so you restore from backup or rebuild the replica. Only atomic 8 KB writes (e.g. ZFS copy-on-write) remove the failure mode.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-05',
      difficulty: 'hard',
      question:
        'With the config below, the primary produces a steady ~20 MB/s of WAL, and the log repeatedly shows the line underneath. What is actually triggering the checkpoints, and what is the right first fix?',
      code: {
        language: 'text',
        title: 'postgresql.conf excerpt and log',
        code: `checkpoint_timeout = 30min
max_wal_size = 1GB
checkpoint_completion_target = 0.9

LOG:  checkpoints are occurring too frequently (51 seconds apart)
HINT:  Consider increasing the configuration parameter "max_wal_size".`,
      },
      options: [
        'checkpoint_timeout: lower it to 1 min so each checkpoint has less to write',
        'checkpoint_completion_target: 0.9 makes checkpoints overlap, so lower it to 0.5',
        'max_wal_size: 1 GB ÷ 20 MB/s ≈ 51 s, so raise it to roughly 2 × (20 MB/s × 1,800 s) ≈ 70 GB so checkpoints become time-driven',
        'Autovacuum: frequent vacuum runs force checkpoints, so raise autovacuum_naptime',
      ],
      correct: [2],
      explanation:
        '1,024 MB ÷ 20 MB/s ≈ 51 s matches the log, so max_wal_size forces a checkpoint long before the 30-minute timeout. Raising it (with disk space for pg_wal) makes checkpoints timed, which spreads I/O and sharply reduces full-page images. Lowering the timeout or the completion target makes I/O burstier and generates more FPIs, and autovacuum does not request checkpoints.',
      followUps: [
        {
          q: 'pg_wal is on a 50 GB volume. What do you do?',
          a: 'Either grow the volume (pg_wal needs headroom above max_wal_size for slots and archive lag) or compromise: `checkpoint_timeout = 10min` with `max_wal_size = 24GB` (20 MB/s × 600 s = 12 GB per cycle, 2× headroom). Add `wal_compression = lz4`, which reduces WAL per cycle and so frees space, and alert on pg_wal usage.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-06',
      difficulty: 'hard',
      question:
        'A clickstream service commits with synchronous_commit = off (default wal_writer_delay). The VM is hard-rebooted by the cloud provider. Which outcome is correct?',
      options: [
        'The cluster may be corrupted and must be restored from backup, as with fsync = off',
        'Only uncommitted transactions are lost; acknowledged ones are always in WAL on disk',
        'Nothing is lost, because the walwriter writes WAL before acknowledging each commit',
        'Up to about 600 ms of transactions that were acknowledged to clients may be missing after recovery, but the database is consistent',
      ],
      correct: [3],
      explanation:
        'Async commit returns before the WAL flush. The walwriter flushes within at most 3 × wal_writer_delay (3 × 200 ms), so an OS-level crash can drop that tail of acknowledged commits. WAL ordering is preserved, so recovery stops at a consistent point. fsync = off is the setting that risks corruption, the walwriter is asynchronous by definition, and claiming acked commits are always durable describes synchronous_commit = on.',
      followUps: [
        {
          q: 'If only the Postgres backend process crashed (not the OS), would anything be lost?',
          a: 'No. Async-committed WAL that was written to the OS page cache survives a Postgres crash, because the kernel still flushes it. Even WAL still in WAL buffers is not lost on a single backend crash unless the whole server is reset before the walwriter flushes. The loss window really applies to OS crashes, power loss and instance termination.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-07',
      difficulty: 'expert',
      question:
        'A read-only reporting query (plain SELECT, no locking clause) runs on the primary. Select ALL mechanisms that can make it cause writes to data files or WAL.',
      options: [
        'Setting hint bits (e.g. HEAP_XMIN_COMMITTED) on tuples whose commit status it had to look up',
        'Opportunistic heap page pruning of dead HOT chains on pages it reads',
        'Evicting a dirty victim buffer during clock-sweep, which requires flushing WAL and writing the page',
        'Updating the xmin of each tuple it reads to its own xid to mark the rows as read',
        'Spilling sorts or hashes beyond work_mem to temporary files',
      ],
      correct: [0, 1, 2],
      explanation:
        'Hint bits dirty pages (and emit FPIs with checksums on). Page pruning can run during reads and is WAL-logged. A backend that needs a buffer may have to write a dirty victim, after flushing WAL up to its LSN. Reads never change xmin. Temp-file spills write to disk, but to temporary files, not data files or WAL, so they do not match the question.',
      followUps: [
        {
          q: 'Which of these also happen on a hot-standby replica running the same query?',
          a: 'A standby cannot write WAL. Pruning does not happen there; it only replays the primary\'s pruning records. Hint bits may be set in memory, but with checksums on the page is not marked dirty for them, so they cause no writes. Evicting dirty pages still happens, because replay dirties pages and a query may have to write one out. Temp-file spills happen too.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-08',
      difficulty: 'expert',
      question:
        '`documents.body` is a 60 KB jsonb value stored compressed out of line (about 10 TOAST chunks). An API does `UPDATE documents SET body = jsonb_set(body, \'{status}\', \'"done"\') WHERE id = $1`. What does Postgres write?',
      options: [
        'A new heap tuple version and a complete new TOAST value (all chunks, recompressed), with WAL for all of it; the old chunks become dead tuples',
        'Only the TOAST chunk that contains the "status" key, plus a small WAL record',
        'Nothing new in TOAST: jsonb updates are applied in place in the existing chunks to avoid bloat',
        'A new heap tuple only; the TOAST pointer is reused because the value\'s length did not change',
      ],
      correct: [0],
      explanation:
        'A jsonb value is one varlena. Modifying any key produces a new value, which is detoasted, rebuilt, recompressed and stored as fresh chunks, and every one of those writes is WAL-logged. The old version keeps its chunks until vacuum removes them. TOAST pointers are reused only when the column is not modified at all. There is no chunk-level patching and no in-place update.',
      followUps: [
        {
          q: 'Would storing the column with STORAGE EXTERNAL (no compression) avoid the rewrite?',
          a: 'No. EXTERNAL only skips compression, which makes substring access to text and bytea cheap. Any modification still writes a whole new value. It would even make the rewrite bigger, since 60 KB uncompressed is about 30 chunks instead of about 10. The real fix is moving frequently changed fields to their own columns.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-09',
      difficulty: 'hard',
      question:
        'After this helper shipped, a payments service sharing the same pg Pool started losing a few acknowledged payments after a host crash. What is the bug?',
      code: {
        language: 'typescript',
        title: 'audit.repository.ts',
        code: `export async function writeAuditEvent(pool: Pool, evt: AuditEvent) {
  const client = await pool.connect();
  try {
    // audit events are re-derivable from logs, so skip the fsync wait
    await client.query('SET synchronous_commit = off');
    await client.query('INSERT INTO audit (kind, body) VALUES ($1, $2)', [evt.kind, evt.body]);
  } finally {
    client.release();
  }
}`,
      },
      options: [
        'synchronous_commit cannot be changed at runtime, so the server ignores it and audit inserts are slow',
        'The INSERT runs outside a transaction, so it is never committed at all',
        'The session-level SET persists on the pooled connection; later payment transactions that borrow it also commit asynchronously',
        'client.release() rolls back the setting, but only after the payment commit has already been flushed',
      ],
      correct: [2],
      explanation:
        'A plain SET changes the session, and the pool hands that same session to the next caller, including payment code that expects synchronous commits, so its commits can be lost in the ≤ 600 ms window. Use BEGIN; SET LOCAL synchronous_commit = off; …; COMMIT. The setting is user-changeable at runtime, autocommit statements do commit, and release() does not reset session settings unless you configure a reset (e.g. DISCARD ALL or PgBouncer server_reset_query in session mode).',
      followUps: [
        {
          q: 'With PgBouncer in transaction pooling mode, does SET LOCAL still work, and does plain SET get worse?',
          a: 'SET LOCAL works, because it lives and dies within the transaction, which is the unit PgBouncer pins to a server connection. A plain SET is worse: it sticks to whichever server connection ran it, and later transactions from *other clients* inherit it. PgBouncer does not run server_reset_query between transactions in this mode by default.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-10',
      difficulty: 'expert',
      question:
        'shared_buffers = 32 GB, and the OLTP working set fits comfortably. Which single operation is MOST likely to evict a large part of the OLTP working set from shared buffers?',
      options: [
        'A sequential scan of a 200 GB table for a nightly report',
        'A manual VACUUM of the same 200 GB table',
        '`UPDATE orders_2023 SET archived = true` over every row of a 6 GB table',
        'COPY of 50 GB of CSV into a new staging table',
      ],
      correct: [2],
      explanation:
        'A seq scan of a table larger than ¼ of shared_buffers (8 GB) uses a 256 KB ring, VACUUM uses its vacuum_buffer_usage_limit ring (2 MB default), and COPY uses a 16 MB bulk-write ring, so all three recycle a small private set of buffers. A 6 GB table is under the ¼ threshold, so its scan goes through the normal clock-sweep. Dirtying every page also defeats rings. The UPDATE pulls the table plus its new versions through the main pool and decrements everyone else\'s usage counts.',
      followUps: [
        {
          q: 'The 200 GB report still slowed OLTP queries. Why, if the shared-buffer cache was protected?',
          a: 'It still read 200 GB through the OS page cache, evicting OS-cached pages that served shared-buffer misses. It also competed for disk bandwidth, used CPU and held a long snapshot that blocks vacuum cleanup everywhere. Move it to a replica, throttle it, or run it from a warehouse fed by CDC.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-11',
      difficulty: 'hard',
      question:
        'A checkpoint started at 10:00:00 (redo point at LSN 5/A0000000) and wrote its checkpoint record at 10:04:30 (LSN 5/F2000000). The server crashed at 10:07:00 before the next checkpoint began. From where does crash recovery start replaying WAL?',
      options: [
        'From 5/F2000000, the checkpoint record, since everything before it is on disk',
        'From the last LSN that the walwriter flushed before the crash, replaying backwards',
        'From the beginning of the oldest WAL segment still in pg_wal',
        'From 5/A0000000, the redo point, because pages dirtied during the checkpoint may not have been written',
      ],
      correct: [3],
      explanation:
        'The checkpoint guarantees only that changes before its redo point (where it started) are on disk. Writes made during its 4.5-minute write phase may or may not have reached disk, so replay starts at the redo point recorded in pg_control. Starting at the checkpoint record would skip changes made during the checkpoint, older segments are just recycling candidates, and WAL replay always runs forward.',
      followUps: [
        {
          q: 'Replay will re-apply records for pages that were already written during the checkpoint. Why is that safe?',
          a: 'Each page carries pd_lsn, the LSN of the last change applied to it. During redo, a record is applied only if the page\'s LSN is older than the record\'s LSN. Already-written pages are skipped, so replay is idempotent. FPIs make even torn pages safe to start from.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-12',
      difficulty: 'hard',
      question:
        'API write p99 spikes line up with checkpoints, which are mostly requested rather than timed. Select ALL changes that address the cause without weakening durability.',
      options: [
        'Raise max_wal_size so checkpoints become time-driven, and provision pg_wal space for it',
        'Keep checkpoint_completion_target at 0.9 so checkpoint writes are spread across the interval',
        'Enable wal_compression = lz4 to shrink the full-page images written after each checkpoint',
        'Set full_page_writes = off so the post-checkpoint WAL burst disappears',
        'Lower checkpoint_timeout to 1 min so each checkpoint has fewer dirty pages to write',
      ],
      correct: [0, 1, 2],
      explanation:
        'Requested checkpoints mean WAL hits max_wal_size first. Raising it, spreading writes and compressing FPIs reduce both the burst and the WAL volume. Disabling full-page writes trades the spike for torn-page corruption risk. A 1-minute timeout multiplies checkpoints and FPIs: each checkpoint is smaller, but there are far more of them and much more WAL.',
      followUps: [
        {
          q: 'Checkpoints are now timed and spread, but the sync phase still shows a 3 s fsync stall. What next?',
          a: 'The kernel is building up a large dirty page cache and flushing it all at fsync. Lower `vm.dirty_background_bytes` (e.g. to 256 MB) so writeback is continuous. Keep `checkpoint_flush_after` (256 kB default on Linux) so the checkpointer asks the kernel to write back as it goes, and consider moving pg_wal to a separate volume so commit fsyncs do not queue behind data writeback.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-13',
      difficulty: 'expert',
      question:
        'You sample pg_stat_io over a peak hour on a write-heavy primary. Which interpretation is right?',
      code: {
        language: 'text',
        title: 'pg_stat_io (object = relation, deltas over 1 hour)',
        code: `   backend_type    | context |  writes  | evictions | fsyncs
-------------------+---------+----------+-----------+-------
 client backend    | normal  | 9,812,004| 10,450,771| 0
 checkpointer      | normal  | 2,104,330|         - | 1,882
 background writer | normal  |   402,118|         - | 0
 autovacuum worker | vacuum  |   310,442|    298,001| 0`,
      },
      options: [
        'Client backends are writing most dirty pages themselves while evicting victims; the bgwriter is not keeping up, or the buffer pool is too small for the dirty working set',
        'Checkpoints are too frequent; lower checkpoint_completion_target to finish them faster',
        'Autovacuum is the main source of write I/O and should be throttled',
        'This is healthy: client backends are expected to write the pages they dirty at commit time',
      ],
      correct: [0],
      explanation:
        'Client backends did ~10M writes in context normal, matching their evictions, against only 0.4M by the bgwriter. Queries are finding dirty victims and paying for the write on the request path. Raise bgwriter_lru_maxpages and the multiplier, and check shared_buffers sizing. Checkpointer writes are moderate, autovacuum writes are small and inside its ring, and backends do not write pages at commit (only WAL).',
      followUps: [
        {
          q: 'After raising bgwriter_lru_maxpages to 1,000, the bgwriter still lags. How do you confirm it is hitting its cap?',
          a: 'Check `maxwritten_clean` in `pg_stat_bgwriter`. It counts the rounds where the bgwriter stopped because it hit `bgwriter_lru_maxpages`. If it keeps rising, the cap is still binding: raise it or `bgwriter_lru_multiplier`, or lower `bgwriter_delay`. If it is flat but backends still write, the dirty rate exceeds what the device absorbs, so you need faster storage or fewer dirtied pages (batching, HOT).',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-14',
      difficulty: 'hard',
      question:
        'A REPEATABLE READ transaction took the snapshot below. All non-listed xids below 210 are committed except as noted. Which tuples are visible to it?',
      code: {
        language: 'text',
        title: 'snapshot and tuple headers',
        code: `snapshot: xmin = 200, xmax = 210, xip = [205, 207]   -- in progress at snapshot time

tuple A: xmin = 150 (committed)  xmax = 205
tuple B: xmin = 207              xmax = 0
tuple C: xmin = 190 (committed)  xmax = 203 (committed)
tuple D: xmin = 212 (committed by now)  xmax = 0`,
      },
      options: ['Only A', 'A and C', 'A and D', 'A, C and D'],
      correct: [0],
      explanation:
        'A: the inserter committed before the snapshot, and the deleter 205 is in xip (in progress), so the delete does not count: visible. B: the inserter 207 is in progress: invisible. C: deleted by 203, which is below xmax, not in xip and committed: invisible. D: 212 ≥ snapshot xmax, so it is treated as in the future even though it has since committed: invisible.',
      followUps: [
        {
          q: 'The same check runs in READ COMMITTED a few seconds later, after 205 and 207 committed. What changes?',
          a: 'A new snapshot is taken per statement, with 205 and 207 now committed and xmax advanced past 212. A becomes invisible (deleted by committed 205), B becomes visible (inserted by committed 207), C stays invisible and D becomes visible. So the visible set changes from {A} to {B, D}.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-15',
      difficulty: 'medium',
      question:
        'A third-party extension segfaults inside one client backend during a query. Every other session on the server sees its connection dropped and the server is unavailable for ~20 s. Why does PostgreSQL behave this way?',
      options: [
        'Backends are threads in one process, so a segfault kills the whole server process',
        'The postmaster cannot rule out that the dead process corrupted shared memory, so it terminates all backends, reinitialises shared memory and runs crash recovery',
        'The OOM killer always kills all Postgres processes together because they share a cgroup',
        'The checkpointer detects an unflushed WAL record and forces an immediate shutdown',
      ],
      correct: [1],
      explanation:
        'Backends are separate processes, but they all write to shared memory (buffers, locks, the proc array). An abnormal exit might have left it inconsistent, so the postmaster sends a signal to every backend, resets shared memory and replays WAL from the last checkpoint. That is the 20 s. Backends are not threads, the OOM killer picks single processes, and the checkpointer does not trigger shutdowns this way.',
      followUps: [
        {
          q: 'How do you reduce the blast radius of risky extensions or memory-hungry queries?',
          a: 'Run risky extensions on a separate cluster or a replica. Cap memory per query (work_mem, statement_timeout, connection limits via a pooler) and set `vm.overcommit_memory = 2` so allocations fail with an error instead of the OOM killer sending SIGKILL. Some teams also protect the postmaster with `oom_score_adj = -1000`.',
        },
      ],
    },
    {
      id: 'db-postgres-internals-mcq-16',
      difficulty: 'expert',
      question:
        'Compare two layouts of the same columns: (a boolean, b bigint, c boolean, d bigint) versus (b bigint, d bigint, a boolean, c boolean), no NULLs, 8 KB pages, MAXALIGN 8. Select ALL statements that are correct.',
      code: {
        language: 'sql',
        title: 'two table definitions',
        code: `CREATE TABLE t_bad  (a boolean, b bigint, c boolean, d bigint);
CREATE TABLE t_good (b bigint, d bigint, a boolean, c boolean);

-- compare stored row width
SELECT pg_column_size(t_bad.*)  FROM t_bad  LIMIT 1;
SELECT pg_column_size(t_good.*) FROM t_good LIMIT 1;`,
      },
      options: [
        'Each t_bad tuple occupies 56 bytes on the page and each t_good tuple occupies 48 bytes',
        't_good saves 14 bytes per row, because all alignment padding disappears',
        'Counting the 4-byte line pointer, a page holds about 136 t_bad rows versus about 157 t_good rows',
        't_good also uses a smaller line pointer, because its tuples are shorter',
        'Both layouts pad the 23-byte tuple header to 24 bytes before the first column',
      ],
      correct: [0, 2, 4],
      explanation:
        't_bad: a at 24, pad to 32; b 32–40; c 40, pad to 48; d 48–56 ⇒ 56 bytes. t_good: b 24–32, d 32–40, a 40, c 41 ⇒ 42 bytes, padded to 48 by tuple MAXALIGN. The saving is 8 bytes, not 14: the raw padding difference is 14, but tuple alignment takes 6 back. Rows per page: 8,168 ÷ 60 ≈ 136 versus 8,168 ÷ 52 ≈ 157. Line pointers are always 4 bytes, and the header pads to t_hoff = 24 in both layouts.',
      followUps: [
        {
          q: 'On a 2-billion-row table, roughly how much space does the reorder save, and is it worth a rewrite?',
          a: '8 bytes × 2B rows = 16 GB of heap (about 13% here), plus less buffer cache and I/O for every scan. But changing column order means rewriting the table (new table + backfill + swap; pg_repack keeps the column order). It is usually worth doing at design time or during a planned partition migration, rarely as a standalone online rewrite.',
        },
      ],
    },
  ],
};

export default topic;
