// Pure model of the write durability path: user buffer → page cache → device write cache → media.
// Each frame says where copies of one committed record live, whether the client has been told
// "committed", and (via survives()) what a crash at that instant would leave behind.
import type { BaseFrame } from '../../core';

export type Loc = 'app' | 'cache' | 'devcache' | 'media';
export const LOCS: Loc[] = ['app', 'cache', 'devcache', 'media'];
export type Strategy = 'buffered' | 'fsync' | 'odirect';
export type Drive = 'plp' | 'consumer' | 'lying';
export type Crash = 'process' | 'kernel' | 'power';
export const CRASHES: Crash[] = ['process', 'kernel', 'power'];

export interface Params {
  strategy: Strategy;
  drive: Drive;
}

export const LOC_NAME: Record<Loc, string> = {
  app: 'User-space buffer',
  cache: 'Page cache (kernel RAM)',
  devcache: 'Device write cache',
  media: 'NAND media',
};
export const CRASH_NAME: Record<Crash, string> = {
  process: 'Process crash',
  kernel: 'Kernel panic',
  power: 'Power loss',
};
export const DRIVE_NAME: Record<Drive, string> = {
  plp: 'Enterprise SSD (power-loss protection)',
  consumer: 'Consumer SSD (honours FLUSH)',
  lying: 'Drive that lies about FLUSH',
};
export const STRATEGY_NAME: Record<Strategy, string> = {
  buffered: 'write() only',
  fsync: 'write() + fsync()',
  odirect: 'O_DIRECT, no fsync',
};

export interface Frame extends BaseFrame {
  /** where a copy of the record currently lives */
  where: Loc[];
  /** page-cache copy is dirty (not yet written back) */
  dirty: boolean;
  /** has the application told the client "committed"? */
  acked: boolean;
  /** the hop that moved data in this frame (from → to) */
  hop?: [Loc, Loc];
  /** the syscall / event that happened */
  event: string;
  /** rough wall-clock cost of this step */
  cost: string;
}

/** Is the device cache effectively non-volatile? (capacitors flush it on power loss) */
const nonVolatileCache = (d: Drive) => d === 'plp';

/** Does a copy survive this crash? */
export function locSurvives(loc: Loc, crash: Crash, drive: Drive): boolean {
  switch (loc) {
    case 'app':
      return false; // process memory dies in every crash
    case 'cache':
      return crash === 'process'; // kernel RAM survives only the process dying
    case 'devcache':
      return crash !== 'power' || nonVolatileCache(drive); // device keeps power through a kernel panic
    case 'media':
      return true;
  }
}

export function survives(where: Loc[], crash: Crash, drive: Drive): boolean {
  return where.some((l) => locSurvives(l, crash, drive));
}

export function simulate(p: Params): Frame[] {
  const { strategy, drive } = p;
  const frames: Frame[] = [];
  const add = (f: Frame) => frames.push(f);
  const flushCost = drive === 'plp' ? '≈20–100 µs' : drive === 'consumer' ? '≈0.5–5 ms' : '≈50 µs (suspiciously fast)';

  add({
    where: ['app'],
    dirty: false,
    acked: false,
    event: 'append to buffer',
    cost: '≈100 ns',
    caption: `The app appends the commit record to a user-space buffer (a logger, BufferedWriter or Node stream). Nothing has left the process yet: any crash, even just the process dying, loses it.`,
    predict: strategy === 'buffered' ? 'The app now calls write() and replies “committed” as soon as it returns. Which crashes can still lose the record?' : undefined,
  });

  if (strategy === 'odirect') {
    add({
      where: ['devcache'],
      dirty: false,
      acked: true,
      hop: ['app', 'devcache'],
      event: 'pwrite(O_DIRECT)',
      cost: '≈20–100 µs',
      caption: `O_DIRECT bypasses the page cache: the device DMAs straight from the aligned buffer into its write cache and the call returns. The app replies “committed”. ${nonVolatileCache(drive) ? 'This drive has power-loss protection, so its cache already counts as durable.' : 'But the device cache is volatile: O_DIRECT is about skipping the page cache, not about durability.'}`,
      predict: nonVolatileCache(drive) ? undefined : 'Power fails right now. Is the acknowledged record on NAND?',
    });
    add({
      where: ['media'],
      dirty: false,
      acked: true,
      hop: ['devcache', 'media'],
      event: 'device destages',
      cost: 'whenever the drive likes',
      caption: `Eventually the drive writes its cache to NAND. Until then a power cut lost an acknowledged write${nonVolatileCache(drive) ? ' on a drive without PLP' : ''}. Databases that use O_DIRECT (InnoDB, ScyllaDB) still call fsync or open with O_DSYNC, which forces FLUSH/FUA.`,
    });
    return frames;
  }

  add({
    where: ['cache'],
    dirty: true,
    acked: strategy === 'buffered',
    hop: ['app', 'cache'],
    event: 'write()',
    cost: '≈1–10 µs',
    caption:
      strategy === 'buffered'
        ? `write() copies the bytes into the page cache, marks the page dirty and returns in microseconds. The app replies “committed”. That survives the process dying, but the record exists only in kernel RAM: a kernel panic or power cut erases it.`
        : `write() copies the bytes into the page cache and marks the page dirty. The app does NOT reply yet: write() returning only means the kernel has a copy.`,
    predict: strategy === 'fsync' ? 'fsync() is next. What does it have to do beyond writing the page to the drive?' : undefined,
  });

  if (strategy === 'buffered') {
    add({
      where: ['cache', 'devcache'],
      dirty: false,
      acked: true,
      hop: ['cache', 'devcache'],
      event: 'writeback (flusher)',
      cost: 'up to ≈30 s later',
      caption: `About 30 s later (dirty_expire_centisecs; the flusher wakes every 5 s) the kernel writes the dirty page back. It lands in the drive’s write cache. ${nonVolatileCache(drive) ? 'With PLP that is durable.' : 'A power cut still loses it; a kernel panic no longer does, because the drive keeps its power.'} For those 30 seconds, every “committed” write was one power cut from vanishing.`,
    });
    add({
      where: ['cache', 'media'],
      dirty: false,
      acked: true,
      hop: ['devcache', 'media'],
      event: 'device destages',
      cost: 'drive-dependent',
      caption: `The drive finally writes its cache to NAND, and the record is durable. Nobody chose when: the app acknowledged before any of this. That is why write() alone is fine for logs you can lose and wrong for commits.`,
    });
    return frames;
  }

  // write + fsync
  add({
    where: ['cache', 'devcache'],
    dirty: false,
    acked: false,
    hop: ['cache', 'devcache'],
    event: 'fsync(): write out',
    cost: '≈10–50 µs',
    caption: `fsync() writes the file’s dirty data and its metadata (size, mtime) to the drive, and the bytes land in the device write cache. fdatasync() would skip metadata not needed to read the data back, which is why Postgres uses it for pre-allocated WAL segments. fsync has not returned yet.`,
  });

  if (drive === 'lying') {
    add({
      where: ['cache', 'devcache'],
      dirty: false,
      acked: false,
      event: 'FLUSH → acked, not done',
      cost: flushCost,
      caption: `The kernel sends a FLUSH (cache flush) command. This drive acknowledges it without writing to NAND: the “SSD lies” problem. A 50 µs fsync on a drive without PLP is a red flag, not a win.`,
      predict: 'fsync() now returns success and the app replies “committed”. Which crash loses it?',
    });
    add({
      where: ['cache', 'devcache'],
      dirty: false,
      acked: true,
      event: 'fsync() returns 0',
      cost: '',
      caption: `fsync() returns 0 and the client hears “committed”, but the only non-RAM copy is still in the drive’s volatile cache. A power cut now loses an acknowledged commit. Test drives with pg_test_fsync and a pull-the-plug test.`,
    });
    add({
      where: ['cache', 'media'],
      dirty: false,
      acked: true,
      hop: ['devcache', 'media'],
      event: 'device destages (later)',
      cost: 'drive-dependent',
      caption: `Some time later the drive really writes NAND. Durability depended on luck, not on fsync.`,
    });
    return frames;
  }

  add({
    where: drive === 'plp' ? ['cache', 'devcache'] : ['cache', 'media'],
    dirty: false,
    acked: false,
    hop: drive === 'plp' ? undefined : ['devcache', 'media'],
    event: drive === 'plp' ? 'FLUSH (PLP: no-op)' : 'FLUSH → NAND',
    cost: flushCost,
    caption:
      drive === 'plp'
        ? `The kernel sends FLUSH. This enterprise SSD has power-loss protection: capacitors will flush its cache if power fails, so the cache already counts as non-volatile and the flush is nearly free.`
        : `The kernel sends FLUSH (or writes with FUA). This consumer SSD really writes its cache to NAND before acknowledging: hundreds of µs to several ms. That cost is the price of durability.`,
  });
  add({
    where: drive === 'plp' ? ['cache', 'devcache'] : ['cache', 'media'],
    dirty: false,
    acked: true,
    event: 'fsync() returns 0',
    cost: '',
    caption: `fsync() returns 0 and only now does the app reply “committed”. Every crash type leaves the record behind. One more rule: if fsync() ever returns an error, do not retry and trust it (fsyncgate). Crash and replay from your own log.`,
  });
  return frames;
}
