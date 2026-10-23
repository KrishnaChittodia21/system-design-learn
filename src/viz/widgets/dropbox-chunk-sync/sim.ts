// Pure model of block-level file sync (no React, Node-testable).
//   Chunking: fixed 8-byte blocks, or content-defined chunking (CDC): a rolling hash over the last
//   3 bytes cuts a boundary where hash % 5 === 0 (min 4, max 16 bytes), so boundaries follow content.
//   Each block is addressed by its content hash (FNV-1a here, SHA-256 in production). The client asks
//   the server which hashes are missing and uploads only those; the commit is a list of hashes with
//   an optimistic base version (409 on mismatch → conflicted copy). Other devices learn about a
//   change via long poll, fetch the block list via /delta and download only blocks they lack.
import type { BaseFrame } from '../../core';

export type Chunking = 'fixed' | 'cdc';
export type Edit = 'insert' | 'overwrite';

export interface Params {
  chunking: Chunking;
  edit: Edit;
}

export const DEFAULT_PARAMS: Params = { chunking: 'cdc', edit: 'insert' };

export const FILE_V1 = 'Q3 revenue grew 12% on APAC demand; margins held at 31%; hiring stays paused until Q1.';
export const INSERT_TEXT = 'DRAFT: ';
export const FIXED = 8;
export const CDC = { window: 3, mod: 5, min: 4, max: 16 };

export function editFile(edit: Edit): string {
  return edit === 'insert' ? INSERT_TEXT + FILE_V1 : FILE_V1.replace('12%', '15%');
}
export const B_EDIT = FILE_V1 + ' Call me.';

/** FNV-1a 32-bit, shown as 4 hex chars */
export function blockHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 4);
}

export function chunk(s: string, mode: Chunking): string[] {
  const out: string[] = [];
  if (mode === 'fixed') {
    for (let i = 0; i < s.length; i += FIXED) out.push(s.slice(i, i + FIXED));
    return out;
  }
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const len = i - start + 1;
    let h = 0;
    for (let k = Math.max(start, i - CDC.window + 1); k <= i; k++) h = (Math.imul(h, 31) + s.charCodeAt(k)) >>> 0;
    if ((len >= CDC.min && h % CDC.mod === 0) || len >= CDC.max) {
      out.push(s.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

export type BlockState = 'upload' | 'dedup' | 'download' | 'local';

export interface Block {
  text: string;
  hash: string;
  state: BlockState;
}

export interface Row {
  label: string;
  device: 'A' | 'B';
  blocks: Block[];
}

export interface Frame extends BaseFrame {
  rows: Row[];
  active: number;
  store: string[];
  storeBytes: number;
  versions: { name: string; version: number; by: string; blocks: number }[];
  devA: string;
  devB: string;
  up: number;
  down: number;
  /** bytes a whole-file sync would have sent so far */
  naive: number;
  status: { text: string; tone: 'good' | 'warn' | 'bad' | 'accent' } | null;
}

export function simulate({ chunking, edit }: Params): Frame[] {
  const frames: Frame[] = [];
  const store = new Map<string, number>();
  const rows: Row[] = [];
  const versions: Frame['versions'] = [];
  let up = 0;
  let down = 0;
  let naive = 0;
  let devA = '—';
  let devB = '—';
  const bHas = new Set<string>();

  const snap = (active: number, caption: string, status: Frame['status'] = null, predict?: string) =>
    frames.push({
      caption,
      predict,
      rows: rows.map((r) => ({ ...r, blocks: r.blocks.map((b) => ({ ...b })) })),
      active,
      store: [...store.keys()],
      storeBytes: [...store.values()].reduce((a, b) => a + b, 0),
      versions: versions.map((v) => ({ ...v })),
      devA,
      devB,
      up,
      down,
      naive,
      status,
    });

  /** client-side: hash blocks, ask the server which are missing, upload those */
  const upload = (label: string, device: 'A' | 'B', text: string) => {
    const blocks: Block[] = chunk(text, chunking).map((t) => ({ text: t, hash: blockHash(t), state: 'local' }));
    const sent = new Set<string>();
    for (const b of blocks) {
      if (store.has(b.hash) || sent.has(b.hash)) b.state = 'dedup';
      else {
        b.state = 'upload';
        sent.add(b.hash);
        store.set(b.hash, b.text.length);
        up += b.text.length;
      }
    }
    naive += text.length;
    rows.push({ label, device, blocks });
    return { blocks, sent: [...sent], bytes: blocks.filter((b) => b.state === 'upload').reduce((a, b) => a + b.text.length, 0) };
  };

  const what = chunking === 'fixed' ? `fixed ${FIXED}-byte blocks` : `content-defined chunks (rolling hash, ${CDC.min}–${CDC.max} bytes)`;

  snap(-1, `Laptop A saves report.txt (${FILE_V1.length} bytes). The client splits it into ${what} and names each block by its content hash.`);

  // 1. A uploads v1
  const v1 = upload('A · v1', 'A', FILE_V1);
  versions.push({ name: 'report.txt', version: 1, by: 'A', blocks: v1.blocks.length });
  devA = 'report.txt v1';
  snap(
    0,
    `A asks the server "which of these ${v1.blocks.length} hashes are missing?". The block store is empty, so all ${v1.sent.length} blocks (${v1.bytes} bytes) are uploaded, then A commits report.txt v1 as a list of hashes.`,
    { text: `commit v1 ✓ (${v1.blocks.length} hashes)`, tone: 'good' },
  );

  // 2. B syncs v1
  for (const b of v1.blocks) {
    if (!bHas.has(b.hash)) {
      down += b.text.length;
      bHas.add(b.hash);
    }
  }
  naive += FILE_V1.length;
  devB = 'report.txt v1';
  snap(
    0,
    `Laptop B's long poll returns "changed". B calls /delta, gets v1's block list and downloads the ${v1.blocks.length} blocks it lacks. Blocks are immutable, so they can be cached anywhere.`,
    { text: 'B now has v1', tone: 'accent' },
  );

  // 3. A edits
  const v2text = editFile(edit);
  const editDesc = edit === 'insert' ? `inserts "${INSERT_TEXT}" at the very start` : 'changes "12%" to "15%" in the middle (same length)';
  const v2 = upload('A · v2', 'A', v2text);
  versions.push({ name: 'report.txt', version: 2, by: 'A', blocks: v2.blocks.length });
  devA = 'report.txt v2';
  const pct = Math.round((v2.bytes / v2text.length) * 100);
  snap(
    1,
    `A ${editDesc} and re-chunks. ${v2.sent.length} of ${v2.blocks.length} blocks ${v2.sent.length === 1 ? 'has a new hash' : 'have new hashes'}, so A uploads ${v2.bytes} of ${v2text.length} bytes (${pct}%)${
      chunking === 'fixed' && edit === 'insert'
        ? ': the insert shifted every fixed boundary, so every block changed'
        : chunking === 'cdc' && edit === 'insert'
          ? ': boundaries follow the content, so the blocks after the insert re-align'
          : ''
    }. A commits v2 with base version 1, which matches the latest, so it succeeds.`,
    { text: 'commit v2 (base 1) ✓', tone: 'good' },
  );

  // 4. B offline edit → 409
  const bRow = upload('B · offline edit', 'B', B_EDIT);
  snap(
    2,
    `Meanwhile B was offline and appended " Call me." to v1. Back online, B uploads only blocks the server lacks: ${bRow.sent.length} new block${bRow.sent.length === 1 ? '' : 's'} (${bRow.bytes} bytes); the other ${bRow.blocks.length - bRow.sent.length} are deduplicated. B commits with base version 1, but the latest is 2.`,
    { text: '409 Conflict: base 1 ≠ latest 2', tone: 'bad' },
    'Last-writer-wins would silently discard A\'s edit. What does Dropbox do instead?',
  );

  // 5. conflicted copy
  versions.push({ name: "report (B's conflicted copy).txt", version: 1, by: 'B', blocks: bRow.blocks.length });
  snap(
    2,
    `B keeps its work as a new file, "report (B's conflicted copy).txt". Its blocks are already in the store, so this commit uploads nothing. No edit is lost and the user merges by hand.`,
    { text: 'conflicted copy committed ✓', tone: 'warn' },
  );

  // 6. B pulls v2 delta
  let need = 0;
  let needBytes = 0;
  for (const b of rows[2].blocks) bHas.add(b.hash);
  const pullRow: Row = {
    label: 'B pulls v2',
    device: 'B',
    blocks: v2.blocks.map((b) => {
      if (bHas.has(b.hash)) return { ...b, state: 'local' as BlockState };
      need++;
      needBytes += b.text.length;
      bHas.add(b.hash);
      return { ...b, state: 'download' as BlockState };
    }),
  };
  down += needBytes;
  naive += v2text.length;
  rows.push(pullRow);
  devB = 'v2 + conflicted copy';
  snap(
    3,
    `B fetches v2's block list via /delta and downloads only the ${need} block${need === 1 ? '' : 's'} (${needBytes} bytes) it does not already have; the rest are reused from its disk.`,
    { text: 'B in sync with v2', tone: 'good' },
  );

  const saved = naive - up - down;
  snap(
    3,
    `Result: ${up} bytes uploaded and ${down} downloaded, versus ${naive} for whole-file sync. ${
      chunking === 'fixed' && edit === 'insert'
        ? 'Fixed blocks are simple and parallel, but one inserted byte near the start re-uploads almost the whole file.'
        : chunking === 'cdc'
          ? 'Content-defined chunking keeps the delta small even for inserts.'
          : 'In-place overwrites are cheap with fixed blocks too.'
    } The store holds ${store.size} unique blocks for ${versions.length} file versions.`,
    saved > 0 ? { text: `${Math.round((1 - (up + down) / naive) * 100)}% fewer bytes than whole-file sync`, tone: 'good' } : null,
  );
  return frames;
}
