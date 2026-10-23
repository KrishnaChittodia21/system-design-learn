// Pure, deterministic model of Postgres's write path and crash recovery.
// A fixed script of UPDATEs, COMMITs, a checkpoint, a background-writer eviction and a WAL-writer
// flush runs until the learner's chosen crash point. The crash wipes shared memory (WAL buffers,
// shared buffers, in-memory commit status); recovery then replays the flushed WAL from the
// checkpoint's redo point and decides which transactions survived.
import type { BaseFrame } from '../../core';

export type PageId = 'A' | 'B' | 'C';
export type SyncCommit = 'on' | 'off';

export interface Params {
  sync: SyncCommit;
  /** power is cut right after this script step (1-based) */
  crashAfter: number;
}

export interface Row {
  account: number;
  /** newest tuple version on the page */
  value: number;
  /** xid that wrote `value` (0 = loaded before the demo, committed) */
  xmin: number;
  /** the previous version, visible if `xmin` did not commit */
  prev: number;
}

export interface Page {
  id: PageId;
  row: Row;
  /** pd_lsn: LSN of the last WAL record that changed the page */
  lsn: number;
  dirty: boolean;
}

export type WalKind = 'update' | 'commit' | 'checkpoint';

export interface WalRecord {
  lsn: number;
  kind: WalKind;
  xid: number;
  page?: PageId;
  value?: number;
  prev?: number;
  /** carries a full-page image (first change to the page since the redo point) */
  fpi?: boolean;
}

export type TxState = 'running' | 'committed' | 'aborted';

export interface Tx {
  xid: number;
  /** what the database knows now */
  state: TxState;
  /** the client was told COMMIT succeeded */
  acked: boolean;
}

export type Phase = 'run' | 'crash' | 'recover' | 'done';

export interface Frame extends BaseFrame {
  phase: Phase;
  step: number;
  /** label of the script step or recovery action */
  action: string;
  wal: WalRecord[];
  flushed: number;
  /** WAL records lost in the crash (were only in WAL buffers) */
  lost: number[];
  /** LSNs replayed so far during recovery */
  replayed: number[];
  /** LSN being replayed this frame */
  cursor: number | null;
  buffers: Partial<Record<PageId, Page>>;
  disk: Record<PageId, Page>;
  redo: number;
  txs: Tx[];
  /** highlight: which page/record/arrow is active */
  hot: { page?: PageId; where?: 'buffer' | 'disk'; lsn?: number; flush?: boolean };
}

export const SCRIPT_LEN = 12;
const ACCOUNT: Record<PageId, number> = { A: 42, B: 7, C: 9 };

type Step =
  | { kind: 'update'; xid: number; page: PageId; value: number }
  | { kind: 'commit'; xid: number }
  | { kind: 'checkpoint' }
  | { kind: 'bgwriter'; page: PageId }
  | { kind: 'walwriter' };

export const SCRIPT: Step[] = [
  { kind: 'update', xid: 101, page: 'A', value: 900 },
  { kind: 'commit', xid: 101 },
  { kind: 'update', xid: 102, page: 'B', value: 650 },
  { kind: 'commit', xid: 102 },
  { kind: 'walwriter' },
  { kind: 'checkpoint' },
  { kind: 'update', xid: 103, page: 'A', value: 850 },
  { kind: 'update', xid: 104, page: 'C', value: 0 },
  { kind: 'bgwriter', page: 'C' },
  { kind: 'commit', xid: 103 },
  { kind: 'update', xid: 105, page: 'A', value: 800 },
  { kind: 'commit', xid: 105 },
];

export const visible = (row: Row, txs: Tx[]) => {
  if (row.xmin === 0) return row.value;
  const t = txs.find((x) => x.xid === row.xmin);
  return t && t.state === 'committed' ? row.value : row.prev;
};

const clonePage = (p: Page): Page => ({ ...p, row: { ...p.row } });

export function simulate({ sync, crashAfter }: Params): Frame[] {
  const crashAt = Math.max(1, Math.min(SCRIPT_LEN, crashAfter));
  const initial = (id: PageId, value: number): Page => ({ id, row: { account: ACCOUNT[id], value, xmin: 0, prev: value }, lsn: 0, dirty: false });
  const disk: Record<PageId, Page> = { A: initial('A', 1000), B: initial('B', 500), C: initial('C', 200) };
  let buffers: Partial<Record<PageId, Page>> = {};
  let wal: WalRecord[] = [];
  let flushed = 0;
  let redo = 1; // the previous checkpoint's redo point: replay would start at LSN 1
  let lsn = 0;
  let txs: Tx[] = [];
  const frames: Frame[] = [];
  let lost: number[] = [];
  const replayed: number[] = [];
  /** pages first touched since the redo point (they need a full-page image) */
  const touched = new Set<PageId>();

  const push = (phase: Phase, step: number, action: string, caption: string, hot: Frame['hot'] = {}, cursor: number | null = null) =>
    frames.push({
      phase,
      step,
      action,
      wal: wal.map((r) => ({ ...r })),
      flushed,
      lost: [...lost],
      replayed: [...replayed],
      cursor,
      buffers: Object.fromEntries(Object.entries(buffers).map(([k, p]) => [k, clonePage(p as Page)])) as Partial<Record<PageId, Page>>,
      disk: { A: clonePage(disk.A), B: clonePage(disk.B), C: clonePage(disk.C) },
      redo,
      txs: txs.map((t) => ({ ...t })),
      hot,
      caption,
    });

  const xlogFlush = (upTo: number) => {
    const before = flushed;
    flushed = Math.max(flushed, Math.min(upTo, lsn));
    return flushed > before;
  };
  const tx = (xid: number) => {
    let t = txs.find((x) => x.xid === xid);
    if (!t) {
      t = { xid, state: 'running', acked: false };
      txs.push(t);
    }
    return t;
  };

  push(
    'run',
    0,
    'start',
    `Three accounts on three heap pages, all on disk and clean. synchronous_commit = ${sync}. The last checkpoint's redo point is LSN 1. Power will be cut after step ${crashAt} of ${SCRIPT_LEN}.`,
  );

  for (let s = 0; s < crashAt; s++) {
    const st = SCRIPT[s];
    const n = s + 1;
    if (st.kind === 'update') {
      tx(st.xid);
      const loaded = buffers[st.page] ? null : 'loaded from disk, ';
      const page = buffers[st.page] ?? clonePage(disk[st.page]);
      const fpi = !touched.has(st.page);
      touched.add(st.page);
      lsn++;
      wal.push({ lsn, kind: 'update', xid: st.xid, page: st.page, value: st.value, prev: page.row.value, fpi });
      page.row = { account: page.row.account, value: st.value, xmin: st.xid, prev: page.row.value };
      page.lsn = lsn;
      page.dirty = true;
      buffers[st.page] = page;
      push(
        'run',
        n,
        `T${st.xid} UPDATE acct ${ACCOUNT[st.page]}`,
        `T${st.xid}: UPDATE account ${ACCOUNT[st.page]} → ${st.value}. Page ${st.page} is ${loaded ?? ''}changed in shared buffers and marked dirty (pd_lsn = ${lsn}). XLogInsert puts the WAL record at LSN ${lsn} into WAL buffers${fpi ? ', with a full-page image because this is the first change to the page since the redo point' : ''}. Nothing has touched disk.`,
        { page: st.page, where: 'buffer', lsn },
      );
    } else if (st.kind === 'commit') {
      lsn++;
      wal.push({ lsn, kind: 'commit', xid: st.xid });
      const t = tx(st.xid);
      t.state = 'committed';
      t.acked = true;
      if (sync === 'on') {
        xlogFlush(lsn);
        push(
          'run',
          n,
          `T${st.xid} COMMIT`,
          `T${st.xid}: COMMIT. The commit record goes to WAL buffers at LSN ${lsn}, then XLogFlush writes and fdatasyncs pg_wal up to LSN ${lsn}: one sequential fsync. Only then is T${st.xid} marked committed and the client told "COMMIT". The data page itself is still only in memory.`,
          { lsn, flush: true },
        );
      } else {
        push(
          'run',
          n,
          `T${st.xid} COMMIT`,
          `T${st.xid}: COMMIT with synchronous_commit = off. The commit record sits in WAL buffers at LSN ${lsn}; the client is told "COMMIT" immediately, without waiting for any fsync. The WAL writer will flush it within about 3 × wal_writer_delay (600 ms).`,
          { lsn },
        );
      }
    } else if (st.kind === 'walwriter') {
      const did = xlogFlush(lsn);
      push(
        'run',
        n,
        'WAL writer wakes',
        did
          ? `The WAL writer wakes (wal_writer_delay = 200 ms) and flushes WAL buffers to pg_wal up to LSN ${flushed}. Asynchronous commits become durable only now.`
          : `The WAL writer wakes (wal_writer_delay = 200 ms): everything up to LSN ${lsn} is already flushed, because each commit flushed its own WAL.`,
        { flush: did },
      );
    } else if (st.kind === 'checkpoint') {
      const redoPoint = lsn + 1;
      const dirty = (Object.keys(buffers) as PageId[]).filter((k) => buffers[k]!.dirty);
      const maxLsn = Math.max(0, ...dirty.map((k) => buffers[k]!.lsn));
      const flushedForData = xlogFlush(maxLsn);
      for (const k of dirty) {
        const p = buffers[k]!;
        p.dirty = false;
        disk[k] = clonePage(p);
      }
      lsn++;
      wal.push({ lsn, kind: 'checkpoint', xid: 0 });
      xlogFlush(lsn);
      redo = redoPoint;
      touched.clear();
      push(
        'run',
        n,
        'CHECKPOINT',
        `CHECKPOINT: record the redo point (LSN ${redoPoint}), write every dirty buffer (pages ${dirty.join(', ') || 'none'}) to the data files and fsync them${flushedForData ? `, after first flushing WAL up to LSN ${maxLsn} (WAL-before-data)` : ''}, then write the checkpoint record and update pg_control. A crash from now on replays from LSN ${redoPoint}, not from the start.`,
        { flush: true },
      );
    } else {
      const p = buffers[st.page]!;
      const did = xlogFlush(p.lsn);
      p.dirty = false;
      disk[st.page] = clonePage(p);
      push(
        'run',
        n,
        `bgwriter writes page ${st.page}`,
        `The background writer evicts dirty page ${st.page}. WAL-before-data: it first calls XLogFlush(${p.lsn}) (pd_lsn)${did ? `, which flushes WAL up to LSN ${flushed}` : ', already flushed'}, then writes the page. The data file now holds T${p.row.xmin}'s uncommitted version (balance ${p.row.value}). That is allowed: visibility is decided by commit status, not by what is on disk.`,
        { page: st.page, where: 'disk', flush: did },
      );
    }
  }

  // ---- crash ----
  lost = wal.filter((r) => r.lsn > flushed).map((r) => r.lsn);
  const acked = txs.filter((t) => t.acked).map((t) => `T${t.xid}`);
  buffers = {};
  const surviving = wal.filter((r) => r.lsn <= flushed);
  push(
    'crash',
    crashAt,
    'power loss',
    `Power cut after step ${crashAt}. Shared buffers, WAL buffers and the in-memory commit status are gone. On disk: the data files, pg_wal up to LSN ${flushed}${lost.length ? ` (LSN ${lost.join(', ')} never left WAL buffers and are lost)` : ''}, and pg_control. Clients were told COMMIT for: ${acked.join(', ') || 'nobody'}.`,
  );
  // transactions are forgotten; commits before the redo point are in the on-disk commit log (pg_xact)
  const commitLsn = new Map(wal.filter((r) => r.kind === 'commit').map((r) => [r.xid, r.lsn]));
  txs = txs.map((t) => ({ ...t, state: commitLsn.has(t.xid) && commitLsn.get(t.xid)! < redo ? 'committed' : 'running' }));
  wal = surviving;

  push(
    'recover',
    crashAt,
    'read pg_control',
    `Restart. The startup process reads pg_control: the last completed checkpoint has redo point LSN ${redo}. Everything before it is already in the data files, so replay starts at LSN ${redo}${flushed >= redo ? ` and runs to the end of valid WAL (LSN ${flushed})` : `, but no WAL at or after LSN ${redo} ever reached disk, so there is nothing to replay`}.`,
    {},
    redo,
  );

  for (const r of wal.filter((x) => x.lsn >= redo)) {
    replayed.push(r.lsn);
    if (r.kind === 'update') {
      const page = buffers[r.page!] ?? clonePage(disk[r.page!]);
      let how: string;
      if (r.fpi) {
        page.row = { account: ACCOUNT[r.page!], value: r.value!, xmin: r.xid, prev: r.prev! };
        page.lsn = r.lsn;
        how = `restores the full-page image of page ${r.page} (balance ${r.value}, pd_lsn ${r.lsn}), so a torn page on disk cannot matter`;
      } else if (page.lsn >= r.lsn) {
        how = `skips it: page ${r.page} already has pd_lsn ${page.lsn} ≥ ${r.lsn}`;
      } else {
        const was = page.lsn;
        page.row = { account: ACCOUNT[r.page!], value: r.value!, xmin: r.xid, prev: page.row.value };
        page.lsn = r.lsn;
        how = `applies it, because page ${r.page}'s pd_lsn ${was} < ${r.lsn} (balance → ${r.value})`;
      }
      page.dirty = true;
      buffers[r.page!] = page;
      push('recover', crashAt, `replay LSN ${r.lsn}`, `Replay LSN ${r.lsn} (T${r.xid} UPDATE page ${r.page}): redo ${how}.`, { page: r.page, where: 'buffer', lsn: r.lsn }, r.lsn);
    } else if (r.kind === 'commit') {
      const t = txs.find((x) => x.xid === r.xid)!;
      t.state = 'committed';
      push('recover', crashAt, `replay LSN ${r.lsn}`, `Replay LSN ${r.lsn}: commit record for T${r.xid}, so T${r.xid} is marked committed in the commit log.`, { lsn: r.lsn }, r.lsn);
    } else {
      push('recover', crashAt, `replay LSN ${r.lsn}`, `Replay LSN ${r.lsn}: the checkpoint record itself; nothing to redo.`, { lsn: r.lsn }, r.lsn);
    }
  }

  const aborted: number[] = [];
  txs = txs.map((t) => {
    if (t.state === 'running') {
      aborted.push(t.xid);
      return { ...t, state: 'aborted' };
    }
    return t;
  });
  const lostAcked = txs.filter((t) => t.acked && t.state !== 'committed').map((t) => `T${t.xid}`);
  const onPages = (Object.keys(disk) as PageId[]).filter((k) => aborted.includes((buffers[k] ?? disk[k]).row.xmin));
  const abortNote = !aborted.length
    ? ''
    : `No commit record exists for ${aborted.map((x) => `T${x}`).join(', ')}, so ${aborted.length === 1 ? 'it is' : 'they are'} aborted. ${
        onPages.length
          ? onPages.length === 1
            ? `The aborted row version on page ${onPages[0]} stays there, but its xmin is aborted, so no snapshot will ever see it (VACUUM cleans it up later). `
            : `The aborted row versions on pages ${onPages.join(' and ')} stay there, but their xmin is aborted, so no snapshot will ever see them (VACUUM cleans them up later). `
          : 'None of their changes reached a data file, so there is nothing to undo. '
      }`;
  const balances = (Object.keys(disk) as PageId[])
    .map((k) => `acct ${ACCOUNT[k]} = ${visible((buffers[k] ?? disk[k]).row, txs)}`)
    .join(', ');
  push(
    'done',
    crashAt,
    'end of WAL',
    `End of valid WAL${flushed ? ` at LSN ${flushed}` : ''}. ${abortNote}Visible balances: ${balances}.`,
  );
  push(
    'done',
    crashAt,
    'verdict',
    lostAcked.length
      ? `Verdict: ${lostAcked.join(', ')} ${lostAcked.length === 1 ? 'was' : 'were'} acknowledged as COMMITTED but ${lostAcked.length === 1 ? 'its' : 'their'} commit record never reached disk, so ${lostAcked.length === 1 ? 'it is' : 'they are'} gone. synchronous_commit = off keeps the database consistent but can lose the last few hundred ms of acknowledged commits.`
      : `Verdict: every transaction the client was told committed (${acked.join(', ') || 'none'}) survived, with no data page fsynced at commit time. Durability came from the WAL; the checkpoint only bounded how much WAL had to be replayed (${replayed.length} record${replayed.length === 1 ? '' : 's'}).`,
  );

  // predictions
  const crashIdx = frames.findIndex((f) => f.phase === 'crash');
  frames[crashIdx - 1].predict = `The power is about to fail. Which of the transactions the client saw commit (${acked.join(', ') || 'none'}) will still be committed after recovery?`;
  const ck = frames.findIndex((f) => f.action === 'CHECKPOINT');
  if (ck > 1 && ck < crashIdx - 1) frames[ck - 1].predict = 'A checkpoint runs next. Which pages will it write, and where will crash recovery start afterwards?';
  const bg = frames.findIndex((f) => f.action.startsWith('bgwriter'));
  if (bg > 1 && bg < crashIdx - 1 && !frames[bg - 1].predict) frames[bg - 1].predict = 'The background writer wants to write page C, which holds an uncommitted change. What must happen first?';
  return frames;
}
