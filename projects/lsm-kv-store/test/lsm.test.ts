import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { SSTable, LsmStore } = mod;
type Store = ReturnType<typeof LsmStore.open>;
type Opts = Parameters<typeof LsmStore.open>[0];

/** Run `fn` with a fresh temp dir that is always removed afterwards. */
async function withDir(fn: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'lsm-test-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Track opened stores so a failing assertion still releases file handles. */
function opener() {
  const open: Store[] = [];
  return {
    open(o: Opts): Store {
      const s = LsmStore.open(o);
      open.push(s);
      return s;
    },
    closeAll() {
      for (const s of open) {
        try {
          s.close();
        } catch {
          /* already closed or never implemented */
        }
      }
    },
  };
}

async function withStore(o: Omit<Opts, 'dir'>, fn: (dir: string, op: ReturnType<typeof opener>) => void): Promise<void> {
  await withDir((dir) => {
    const op = opener();
    try {
      fn(dir, op);
    } finally {
      op.closeAll();
    }
  });
}

const pad = (i: number) => String(i).padStart(5, '0');
const sstFiles = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.sst'));

// ---------- M1: SSTable ----------

test('M1: SSTable round-trips values and tombstones; misses return undefined', () =>
  withDir((dir) => {
    const t = SSTable.write(join(dir, 'a.sst'), [['apple', '1'], ['banana', null], ['cherry', 'red\nfruit ✓']], 2);
    try {
      assert.equal(t.count, 3);
      assert.equal(t.get('apple'), '1');
      assert.equal(t.get('banana'), null);
      assert.equal(t.get('cherry'), 'red\nfruit ✓');
      assert.equal(t.get('apricot'), undefined);
      assert.equal(t.get('zzz'), undefined);
      assert.equal(t.minKey, 'apple');
      assert.equal(t.maxKey, 'cherry');
    } finally {
      t.close();
    }
    const again = SSTable.open(join(dir, 'a.sst'));
    try {
      assert.deepEqual(again.entries(), [['apple', '1'], ['banana', null], ['cherry', 'red\nfruit ✓']]);
    } finally {
      again.close();
    }
  }));

test('M1: SSTable.write rejects unsorted or duplicate keys', () =>
  withDir((dir) => {
    const realError = (e: unknown) => e instanceof Error && !e.message.startsWith('Not implemented');
    assert.throws(() => SSTable.write(join(dir, 'x.sst'), [['b', '1'], ['a', '2']]), realError);
    assert.throws(() => SSTable.write(join(dir, 'y.sst'), [['a', '1'], ['a', '2']]), realError);
  }));

test('M1: sparse index — one entry per interval, and a point read touches one block only', () =>
  withDir((dir) => {
    const entries: Array<[string, string]> = [];
    for (let i = 0; i < 10_000; i++) entries.push(['key' + pad(i), 'value-' + i + '-'.repeat(10)]);
    const path = join(dir, 'big.sst');
    const t = SSTable.write(path, entries, 16);
    try {
      assert.equal(t.indexEntries, 625);
      assert.equal(t.bytesRead, 0);
      assert.equal(t.get('key07777'), 'value-7777----------');
      const fileSize = statSync(path).size;
      assert.ok(t.bytesRead > 0 && t.bytesRead < 4096, `read ${t.bytesRead} of ${fileSize} bytes`);
      const before = t.bytesRead;
      assert.equal(t.get('aaa'), undefined);
      assert.equal(t.get('zzz'), undefined);
      assert.equal(t.bytesRead, before, 'keys outside [minKey, maxKey] must not touch the disk');
    } finally {
      t.close();
    }
  }));

test('M1: SSTable.entries honours [start, end) bounds across blocks', () =>
  withDir((dir) => {
    const entries: Array<[string, string]> = [];
    for (let i = 0; i < 100; i++) entries.push(['k' + pad(i), String(i)]);
    const t = SSTable.write(join(dir, 'r.sst'), entries, 8);
    try {
      const got = t.entries('k00013', 'k00042');
      assert.equal(got.length, 29);
      assert.deepEqual(got[0], ['k00013', '13']);
      assert.deepEqual(got.at(-1), ['k00041', '41']);
      assert.equal(t.entries('k00099x').length, 0);
      assert.equal(t.entries(undefined, 'k00005').length, 5);
    } finally {
      t.close();
    }
  }));

// ---------- M2: memtable + WAL ----------

test('M2: put/get/delete/overwrite in the memtable', () =>
  withStore({}, (dir, op) => {
    const s = op.open({ dir });
    assert.equal(s.get('a'), undefined);
    s.put('a', '1');
    s.put('b', '2');
    s.put('a', '3');
    s.delete('b');
    assert.equal(s.get('a'), '3');
    assert.equal(s.get('b'), undefined);
    assert.equal(s.memtableSize, 2, 'a tombstone still occupies the memtable');
    assert.deepEqual(s.tables(), []);
  }));

test('M2: WAL replay restores unflushed writes after a crash (no close)', () =>
  withStore({}, (dir, op) => {
    const s = op.open({ dir });
    s.put('x', '1');
    s.put('y', '2');
    s.delete('x');
    s.put('z', 'multi\nline "quoted"');
    // simulate a crash: no flush, no close — just open the directory again
    const s2 = op.open({ dir });
    assert.equal(s2.get('x'), undefined);
    assert.equal(s2.get('y'), '2');
    assert.equal(s2.get('z'), 'multi\nline "quoted"');
    assert.deepEqual(s2.tables(), []);
  }));

test('M2: a torn final WAL record is ignored and the log stays usable', () =>
  withStore({}, (dir, op) => {
    const s = op.open({ dir });
    s.put('a', 'first');
    s.put('b', 'second');
    s.put('c', 'third-value');
    s.close();
    const wal = join(dir, 'wal.log');
    truncateSync(wal, statSync(wal).size - 3); // power loss mid-write
    const s2 = op.open({ dir });
    assert.equal(s2.get('a'), 'first');
    assert.equal(s2.get('b'), 'second');
    assert.equal(s2.get('c'), undefined);
    s2.put('d', 'after-recovery');
    s2.close();
    const s3 = op.open({ dir });
    assert.equal(s3.get('d'), 'after-recovery');
    assert.equal(s3.get('a'), 'first');
  }));

test('M2: a closed store rejects operations', () =>
  withStore({}, (dir, op) => {
    const s = op.open({ dir });
    s.close();
    assert.throws(() => s.get('a'));
    assert.throws(() => s.put('a', '1'));
  }));

// ---------- M3: flush & reads across levels ----------

test('M3: memtable flushes at the threshold into an SSTable and the WAL is emptied', () =>
  withStore({ memtableMaxEntries: 5, autoCompact: false }, (dir, op) => {
    const s = op.open({ dir, memtableMaxEntries: 5, autoCompact: false });
    for (let i = 0; i < 5; i++) s.put('k' + i, 'v' + i);
    assert.equal(s.memtableSize, 0);
    assert.equal(s.tables().length, 1);
    assert.equal(s.tables()[0].tier, 0);
    assert.equal(s.tables()[0].count, 5);
    assert.equal(statSync(join(dir, 'wal.log')).size, 0);
    assert.equal(sstFiles(dir).length, 1);
    s.flush(); // empty memtable → no new table
    assert.equal(s.tables().length, 1);
  }));

test('M3: reads go newest → oldest; tombstones in newer tables hide older values', () =>
  withStore({}, (dir, op) => {
    const s = op.open({ dir, autoCompact: false });
    s.put('a', 'old');
    s.put('b', 'keep');
    s.put('c', 'doomed');
    s.flush();
    s.put('a', 'new');
    s.delete('c');
    s.flush();
    s.put('a', 'newest');
    assert.equal(s.get('a'), 'newest');
    s.delete('a');
    assert.equal(s.get('a'), undefined, 'memtable tombstone hides SSTable values');
    assert.equal(s.get('b'), 'keep');
    assert.equal(s.get('c'), undefined);
    assert.equal(s.tables().length, 2);
    assert.ok(s.tables()[0].id > s.tables()[1].id, 'tables() is newest first');
  }));

test('M3: SSTables survive restart and are read correctly together with the WAL', () =>
  withStore({}, (dir, op) => {
    const s = op.open({ dir, memtableMaxEntries: 10, autoCompact: false });
    for (let i = 0; i < 35; i++) s.put('k' + pad(i), 'v' + i);
    s.delete('k00003');
    s.close();
    const s2 = op.open({ dir, memtableMaxEntries: 10, autoCompact: false });
    assert.equal(s2.tables().length, 3);
    assert.equal(s2.memtableSize, 6);
    assert.equal(s2.get('k00000'), 'v0');
    assert.equal(s2.get('k00003'), undefined);
    assert.equal(s2.get('k00034'), 'v34');
  }));

// ---------- M4: range scan ----------

test('M4: scan merges memtable + tables, newest wins, tombstones hidden, [start, end)', () =>
  withStore({}, (dir, op) => {
    const s = op.open({ dir, autoCompact: false });
    s.put('a', '1');
    s.put('b', '1');
    s.put('c', '1');
    s.put('d', '1');
    s.flush();
    s.put('b', '2');
    s.delete('c');
    s.flush();
    s.put('e', '3');
    s.put('a', '3');
    assert.deepEqual(s.scan(), [['a', '3'], ['b', '2'], ['d', '1'], ['e', '3']]);
    assert.deepEqual(s.scan('b', 'e'), [['b', '2'], ['d', '1']]);
    assert.deepEqual(s.scan('x'), []);
  }));

// ---------- M5: size-tiered compaction ----------

test('M5: reaching the threshold merges a tier into one higher-tier table and deletes inputs', () =>
  withStore({}, (dir, op) => {
    const o = { dir, memtableMaxEntries: 10, compactionThreshold: 4 };
    const s = op.open(o);
    for (let i = 0; i < 30; i++) s.put('k' + pad(i), 'v' + i);
    assert.deepEqual(s.tables().map((t) => t.tier), [0, 0, 0]);
    for (let i = 30; i < 40; i++) s.put('k' + pad(i), 'v' + i);
    assert.deepEqual(s.tables().map((t) => t.tier), [1]);
    assert.equal(s.tables()[0].count, 40);
    assert.equal(sstFiles(dir).length, 1, 'input tables must be deleted');
    for (let i = 40; i < 50; i++) s.put('k' + pad(i), 'v' + i);
    assert.deepEqual(s.tables().map((t) => t.tier), [0, 1]);
    for (let i = 0; i < 50; i += 7) assert.equal(s.get('k' + pad(i)), 'v' + i);
  }));

test('M5: compaction keeps only the newest version of each key', () =>
  withStore({}, (dir, op) => {
    const s = op.open({ dir, memtableMaxEntries: 3, compactionThreshold: 3 });
    for (let round = 0; round < 3; round++) {
      s.put('a', 'a' + round);
      s.put('b', 'b' + round);
      s.put('c', 'c' + round);
    }
    assert.deepEqual(s.tables().map((t) => [t.tier, t.count]), [[1, 3]]);
    assert.deepEqual(s.scan(), [['a', 'a2'], ['b', 'b2'], ['c', 'c2']]);
  }));

test('M5: tombstones are KEPT when an older table still holds the key (no resurrection)', () =>
  withStore({}, (dir, op) => {
    const s = op.open({ dir, memtableMaxEntries: 2, compactionThreshold: 3 });
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) s.put(k, 'v-' + k); // 3 flushes → one tier-1 table
    assert.deepEqual(s.tables().map((t) => t.tier), [1]);
    s.delete('a');
    s.put('g', '1'); // flush
    s.put('h', '1');
    s.put('i', '1'); // flush
    s.put('j', '1');
    s.put('k', '1'); // flush → merge the three tier-0 tables while an older tier-1 table exists
    assert.deepEqual(s.tables().map((t) => [t.tier, t.count]), [[1, 6], [1, 6]]);
    assert.equal(s.get('a'), undefined, 'deleted key resurrected by compaction');
    s.close();
    const s2 = op.open({ dir, memtableMaxEntries: 2, compactionThreshold: 3 });
    assert.equal(s2.get('a'), undefined);
  }));

test('M5: full compact() drops shadowed versions and all tombstones', () =>
  withStore({}, (dir, op) => {
    const s = op.open({ dir, autoCompact: false });
    s.put('a', '1');
    s.put('b', '1');
    s.flush();
    s.delete('a');
    s.put('b', '2');
    s.put('c', '2');
    s.flush();
    s.compact();
    assert.equal(s.tables().length, 1);
    assert.equal(s.tables()[0].count, 2);
    assert.deepEqual(s.scan(), [['b', '2'], ['c', '2']]);
    assert.equal(sstFiles(dir).length, 1);
    s.delete('b');
    s.delete('c');
    s.flush();
    s.compact();
    assert.deepEqual(s.tables(), [], 'compacting to nothing leaves no table');
    assert.equal(sstFiles(dir).length, 0);
  }));

test('M5: matches an in-memory model over 3,000 random ops, before and after restart', () =>
  withStore({}, (dir, op) => {
    const o = { dir, memtableMaxEntries: 40, compactionThreshold: 3, indexInterval: 4 };
    let s = op.open(o);
    const model = new Map<string, string>();
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
    for (let i = 0; i < 3000; i++) {
      const k = 'key' + pad(rnd(300));
      if (rnd(10) < 7) {
        const v = 'v' + i;
        s.put(k, v);
        model.set(k, v);
      } else {
        s.delete(k);
        model.delete(k);
      }
      if (i % 500 === 0) assert.equal(s.get(k), model.get(k));
    }
    const expected = [...model].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    assert.deepEqual(s.scan(), expected);
    assert.ok(s.tables().length < 10, `compaction should bound table count, got ${s.tables().length}`);
    assert.equal(sstFiles(dir).length, s.tables().length, 'no leaked .sst files');
    s.close();
    s = op.open(o);
    assert.deepEqual(s.scan(), expected);
    for (let i = 0; i < 300; i++) assert.equal(s.get('key' + pad(i)), model.get('key' + pad(i)));
  }));
