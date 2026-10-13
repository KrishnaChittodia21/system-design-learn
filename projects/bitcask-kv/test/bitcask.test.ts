import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { crc32 } from 'node:zlib';

const mod = (await import(process.env.PROJECT_IMPL!)) as typeof import('../solution/index.ts');
const { Bitcask, encodeRecord, decodeRecord, CorruptionError, HEADER_SIZE, TOMBSTONE } = mod;

/** Fresh temp dir per test, removed afterwards (even on failure). */
async function withDir(fn: (dir: string) => Promise<void> | void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bitcask-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const dataFiles = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.data')).sort();
const hintFiles = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.hint')).sort();
const str = (b: Buffer | undefined) => b?.toString('utf8');

test('M1: record encoding — crc32 | keyLen | valueLen | key | value, big-endian', () => {
  const rec = encodeRecord('ab', Buffer.from('xyz'));
  assert.equal(HEADER_SIZE, 12);
  assert.equal(rec.length, 12 + 2 + 3);
  assert.equal(rec.readUInt32BE(4), 2);
  assert.equal(rec.readUInt32BE(8), 3);
  assert.equal(rec.toString('utf8', 12, 14), 'ab');
  assert.equal(rec.toString('utf8', 14), 'xyz');
  assert.equal(rec.readUInt32BE(0), crc32(rec.subarray(4)));
  const tomb = encodeRecord('ab', null);
  assert.equal(tomb.length, 14);
  assert.equal(tomb.readUInt32BE(8), TOMBSTONE);
  assert.equal(encodeRecord('ключ', Buffer.alloc(0)).readUInt32BE(4), 8, 'key length is in UTF-8 bytes');
});

test('M1: decodeRecord round-trips and detects truncation and corruption', () => {
  const a = encodeRecord('k1', Buffer.from('v1'));
  const b = encodeRecord('k2', null);
  const buf = Buffer.concat([a, b]);
  assert.deepEqual(decodeRecord(buf, 0), { kind: 'ok', key: 'k1', value: Buffer.from('v1'), size: a.length });
  assert.deepEqual(decodeRecord(buf, a.length), { kind: 'ok', key: 'k2', value: null, size: b.length });
  assert.deepEqual(decodeRecord(buf.subarray(0, 5), 0), { kind: 'truncated' });
  assert.deepEqual(decodeRecord(buf.subarray(0, a.length - 1), 0), { kind: 'truncated' });
  const bad = Buffer.from(a);
  bad[bad.length - 1] ^= 0xff;
  assert.deepEqual(decodeRecord(bad, 0), { kind: 'corrupt' });
  const empty = encodeRecord('e', Buffer.alloc(0));
  assert.deepEqual(decodeRecord(empty, 0), { kind: 'ok', key: 'e', value: Buffer.alloc(0), size: 13 }, 'empty value ≠ tombstone');
});

test('M2: put/get/overwrite/keys, with string and binary values', async () => {
  await withDir((dir) => {
    const db = Bitcask.open({ dir });
    try {
      assert.equal(db.get('missing'), undefined);
      db.put('user:1', 'alice');
      db.put('user:2', Buffer.from([0, 255, 1, 254]));
      db.put('user:1', 'alice-v2');
      db.put('empty', '');
      assert.equal(str(db.get('user:1')), 'alice-v2');
      assert.deepEqual(db.get('user:2'), Buffer.from([0, 255, 1, 254]));
      assert.deepEqual(db.get('empty'), Buffer.alloc(0));
      assert.deepEqual(db.keys(), ['empty', 'user:1', 'user:2']);
      assert.equal(db.stats().liveKeys, 3);
    } finally {
      db.close();
    }
  });
});

test('M2: the data file is append-only — an overwrite adds a record, it never rewrites in place', async () => {
  await withDir((dir) => {
    const db = Bitcask.open({ dir });
    try {
      db.put('k', 'v1');
      const [file] = dataFiles(dir);
      const first = fs.readFileSync(path.join(dir, file));
      db.put('k', 'v2');
      const second = fs.readFileSync(path.join(dir, file));
      assert.equal(second.length, first.length * 2);
      assert.deepEqual(second.subarray(0, first.length), first, 'old bytes untouched');
      assert.equal(dataFiles(dir).length, 1);
      assert.match(file, /^\d{6}\.data$/);
    } finally {
      db.close();
    }
  });
});

test('M2: data survives close and reopen (the keydir is rebuilt from the files)', async () => {
  await withDir((dir) => {
    const db = Bitcask.open({ dir });
    for (let i = 0; i < 100; i++) db.put(`k${i}`, `v${i}`);
    db.put('k5', 'five');
    db.close();
    assert.throws(() => db.get('k1'), 'closed store rejects calls');
    const again = Bitcask.open({ dir });
    try {
      assert.equal(again.keys().length, 100);
      assert.equal(str(again.get('k5')), 'five');
      assert.equal(str(again.get('k99')), 'v99');
      again.put('after', 'reopen');
      assert.equal(str(again.get('after')), 'reopen');
    } finally {
      again.close();
    }
  });
});

test('M3: delete writes a tombstone; deleted keys stay deleted across reopen', async () => {
  await withDir((dir) => {
    const db = Bitcask.open({ dir });
    db.put('a', '1');
    db.put('b', '2');
    const before = db.stats().diskBytes;
    assert.equal(db.delete('a'), true);
    assert.equal(db.stats().diskBytes, before + HEADER_SIZE + 1, 'a tombstone record was appended');
    assert.equal(db.delete('a'), false, 'deleting a missing key writes nothing');
    assert.equal(db.stats().diskBytes, before + HEADER_SIZE + 1);
    assert.equal(db.get('a'), undefined);
    db.close();
    const again = Bitcask.open({ dir });
    try {
      assert.equal(again.get('a'), undefined);
      assert.deepEqual(again.keys(), ['b']);
      again.put('a', 'reborn');
      assert.equal(str(again.get('a')), 'reborn');
    } finally {
      again.close();
    }
  });
});

test('M4: the active file rotates before it would exceed maxFileBytes', async () => {
  await withDir((dir) => {
    const db = Bitcask.open({ dir, maxFileBytes: 100 });
    try {
      const rec = encodeRecord('key-00', Buffer.from('x'.repeat(20))).length; // 38 bytes
      for (let i = 0; i < 10; i++) db.put(`key-${String(i).padStart(2, '0')}`, 'x'.repeat(20));
      const files = dataFiles(dir);
      assert.equal(files.length, 5, `two ${rec}-byte records per 100-byte file`);
      for (const f of files) assert.ok(fs.statSync(path.join(dir, f)).size <= 100);
      assert.deepEqual(files, ['000001.data', '000002.data', '000003.data', '000004.data', '000005.data']);
      db.put('huge', 'y'.repeat(500));
      assert.equal(str(db.get('huge'))?.length, 500, 'a record bigger than the limit gets a file of its own');
      for (let i = 0; i < 10; i++) assert.equal(str(db.get(`key-${String(i).padStart(2, '0')}`)), 'x'.repeat(20));
    } finally {
      db.close();
    }
    const again = Bitcask.open({ dir, maxFileBytes: 100 });
    try {
      assert.equal(again.keys().length, 11);
      assert.equal(str(again.get('key-07')), 'x'.repeat(20));
    } finally {
      again.close();
    }
  });
});

test('M4: reads hit the right file and offset after many rotations and overwrites', async () => {
  await withDir((dir) => {
    const db = Bitcask.open({ dir, maxFileBytes: 256 });
    const model = new Map<string, string>();
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    try {
      for (let i = 0; i < 400; i++) {
        const k = `k${Math.floor(rand() * 40)}`;
        if (rand() < 0.2) { db.delete(k); model.delete(k); }
        else { const v = `v${i}-${'z'.repeat(Math.floor(rand() * 30))}`; db.put(k, v); model.set(k, v); }
      }
      assert.ok(dataFiles(dir).length > 10);
      assert.deepEqual(db.keys(), [...model.keys()].sort());
      for (const [k, v] of model) assert.equal(str(db.get(k)), v);
    } finally {
      db.close();
    }
  });
});

test('M5: merge keeps only live values, shrinks the disk and writes hint files', async () => {
  await withDir((dir) => {
    const db = Bitcask.open({ dir, maxFileBytes: 200 });
    try {
      for (let round = 0; round < 20; round++) for (let k = 0; k < 5; k++) db.put(`k${k}`, `round-${round}`);
      db.delete('k4');
      const before = db.stats();
      db.merge();
      const after = db.stats();
      assert.ok(after.diskBytes < before.diskBytes / 5, `${after.diskBytes} vs ${before.diskBytes}`);
      assert.ok(after.dataFiles < before.dataFiles);
      assert.equal(hintFiles(dir).length, after.dataFiles, 'one hint per merged data file');
      assert.deepEqual(db.keys(), ['k0', 'k1', 'k2', 'k3']);
      for (let k = 0; k < 4; k++) assert.equal(str(db.get(`k${k}`)), 'round-19');
      const maxMerged = Math.max(...dataFiles(dir).map((f) => Number(f.slice(0, 6))));
      db.put('new', 'write');
      const newest = Math.max(...dataFiles(dir).map((f) => Number(f.slice(0, 6))));
      assert.ok(newest > maxMerged, 'writes after a merge go to a new file, never into merged files');
    } finally {
      db.close();
    }
  });
});

test('M5: after merge, reopen loads the hint files and deleted keys are not resurrected', async () => {
  await withDir((dir) => {
    const db = Bitcask.open({ dir, maxFileBytes: 150 });
    for (let i = 0; i < 30; i++) db.put(`k${i % 6}`, `v${i}`);
    db.delete('k0');
    db.delete('k1');
    db.merge();
    db.put('k2', 'post-merge');
    db.delete('k3');
    db.close();
    const again = Bitcask.open({ dir, maxFileBytes: 150 });
    try {
      assert.ok(again.stats().hintFilesLoaded >= 1);
      assert.deepEqual(again.keys(), ['k2', 'k4', 'k5']);
      assert.equal(str(again.get('k2')), 'post-merge');
      assert.equal(str(again.get('k5')), 'v29');
      assert.equal(again.get('k0'), undefined);
      again.merge();
      again.merge(); // idempotent
      assert.deepEqual(again.keys(), ['k2', 'k4', 'k5']);
      assert.equal(str(again.get('k4')), 'v28');
    } finally {
      again.close();
    }
  });
});

test('M6: a torn final record (crash mid-write) is truncated on open; earlier data survives', async () => {
  await withDir((dir) => {
    const db = Bitcask.open({ dir });
    db.put('a', 'apple');
    db.put('b', 'banana');
    db.close();
    const file = path.join(dir, dataFiles(dir)[0]);
    const goodSize = fs.statSync(file).size;
    fs.appendFileSync(file, encodeRecord('c', Buffer.from('cherry')).subarray(0, 9)); // half a header
    const again = Bitcask.open({ dir });
    try {
      assert.equal(fs.statSync(file).size, goodSize, 'the torn tail is cut off');
      assert.deepEqual(again.keys(), ['a', 'b']);
      again.put('c', 'cherry');
      assert.equal(str(again.get('c')), 'cherry');
    } finally {
      again.close();
    }
    const third = Bitcask.open({ dir });
    try {
      assert.equal(str(third.get('c')), 'cherry', 'the write after recovery is readable after another reopen');
      assert.equal(str(third.get('b')), 'banana');
    } finally {
      third.close();
    }
  });
});

test('M6: a CRC mismatch in the last record drops that write — the key reverts to its previous value', async () => {
  await withDir((dir) => {
    const db = Bitcask.open({ dir });
    db.put('k', 'v1');
    db.put('k', 'v2');
    db.close();
    const file = path.join(dir, dataFiles(dir)[0]);
    const buf = fs.readFileSync(file);
    buf[buf.length - 1] ^= 0x01; // flip a bit in the last value byte
    fs.writeFileSync(file, buf);
    const again = Bitcask.open({ dir });
    try {
      assert.equal(str(again.get('k')), 'v1');
      assert.equal(fs.statSync(file).size, encodeRecord('k', Buffer.from('v1')).length);
    } finally {
      again.close();
    }
  });
});

test('M6: corruption in an older (immutable) file is not silently truncated — open throws', async () => {
  await withDir((dir) => {
    const db = Bitcask.open({ dir, maxFileBytes: 40 });
    db.put('a', 'x'.repeat(20));
    db.put('b', 'y'.repeat(20));
    db.close();
    assert.equal(dataFiles(dir).length, 2);
    const first = path.join(dir, dataFiles(dir)[0]);
    const buf = fs.readFileSync(first);
    buf[HEADER_SIZE + 3] ^= 0xff;
    fs.writeFileSync(first, buf);
    assert.throws(() => Bitcask.open({ dir, maxFileBytes: 40 }).close(), CorruptionError);
  });
});

test('M6: get verifies the CRC of what it reads (bit rot after open is detected)', async () => {
  await withDir((dir) => {
    const db = Bitcask.open({ dir });
    try {
      db.put('a', 'apple');
      db.put('b', 'banana');
      const file = path.join(dir, dataFiles(dir)[0]);
      const fd = fs.openSync(file, 'r+');
      fs.writeSync(fd, Buffer.from('Z'), 0, 1, HEADER_SIZE + 1 + 2); // inside "apple"
      fs.closeSync(fd);
      assert.throws(() => db.get('a'), CorruptionError);
      assert.equal(str(db.get('b')), 'banana');
    } finally {
      db.close();
    }
  });
});

test('M7: fsync policy — always, never, or every N writes', async () => {
  await withDir((dir) => {
    const always = Bitcask.open({ dir: path.join(dir, 'a'), fsync: 'always' });
    const never = Bitcask.open({ dir: path.join(dir, 'n'), fsync: 'never' });
    const batched = Bitcask.open({ dir: path.join(dir, 'b'), fsync: { everyWrites: 3 } });
    const deflt = Bitcask.open({ dir: path.join(dir, 'd') });
    try {
      for (const db of [always, never, batched, deflt]) {
        for (let i = 0; i < 6; i++) db.put(`k${i}`, 'v');
        db.delete('k0');
      }
      assert.equal(always.stats().fsyncs, 7);
      assert.equal(never.stats().fsyncs, 0);
      assert.equal(batched.stats().fsyncs, 2);
      assert.equal(deflt.stats().fsyncs, 0, "the default is 'never' (like Bitcask's default)");
    } finally {
      for (const db of [always, never, batched, deflt]) db.close();
    }
  });
});

test('M7: everything lives under the injected directory; a new directory is created on demand', async () => {
  await withDir((dir) => {
    const nested = path.join(dir, 'deep', 'er');
    const db = Bitcask.open({ dir: nested, maxFileBytes: 64 });
    try {
      for (let i = 0; i < 10; i++) db.put(`k${i}`, 'value-value');
      db.merge();
      const files = fs.readdirSync(nested);
      assert.ok(files.length > 0);
      assert.ok(files.every((f) => /^\d{6}\.(data|hint)$/.test(f)), `unexpected files: ${files.join(', ')}`);
      assert.deepEqual(fs.readdirSync(dir), ['deep']);
    } finally {
      db.close();
    }
  });
});
