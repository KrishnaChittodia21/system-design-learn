// Pure model of durability for one 96 MB object on a 16-node cluster stored with 3× replication or Reed–Solomon
// erasure coding (k data + m parity chunks on distinct nodes / failure domains).
// Frames: write → fail nodes one by one (optionally repairing in between) until the object is
// unrecoverable or the scripted failures run out. Any k of the k+m chunks rebuild the object.
import type { BaseFrame } from '../../core';

export type Scheme = 'rep3' | 'ec4+2' | 'ec8+4';
export const OBJECT_MB = 96;
export const NODES = 16; // 4 racks × 4 nodes

export interface Params {
  scheme: Scheme;
  /** repair (re-replicate / re-encode) after every failure before the next one hits */
  repair: boolean;
  seed: number;
}

export interface SchemeInfo {
  label: string;
  /** chunks needed to read */
  k: number;
  /** extra chunks (failures tolerated) */
  m: number;
  /** size of each stored chunk in MB */
  chunkMB: number;
  replicated: boolean;
  nines: string;
}

export function schemeInfo(s: Scheme): SchemeInfo {
  if (s === 'rep3') return { label: '3× replication', k: 1, m: 2, chunkMB: OBJECT_MB, replicated: true, nines: '~6 nines' };
  const [k, m] = s === 'ec4+2' ? [4, 2] : [8, 4];
  return { label: `EC ${k}+${m}`, k, m, chunkMB: OBJECT_MB / k, replicated: false, nines: k === 8 ? '~11 nines' : '' };
}

export const rawMB = (s: Scheme) => {
  const i = schemeInfo(s);
  return (i.k + i.m) * i.chunkMB;
};
export const overheadPct = (s: Scheme) => Math.round((rawMB(s) / OBJECT_MB - 1) * 100);
/** bytes read from survivors to rebuild ONE lost chunk */
export const repairReadMB = (s: Scheme) => {
  const i = schemeInfo(s);
  return i.replicated ? i.chunkMB : i.k * i.chunkMB;
};
/** nodes a normal (healthy) read touches */
export const readFanout = (s: Scheme) => schemeInfo(s).k;

/** deterministic shuffle of node ids */
function order(seed: number): number[] {
  const a = Array.from({ length: NODES }, (_, i) => i);
  let x = seed * 2654435761 + 1;
  for (let i = a.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Chunk {
  /** 'D1'..'Dk', 'P1'..'Pm' or 'copy 1..3' */
  name: string;
  parity: boolean;
  node: number;
  alive: boolean;
  rebuilt: boolean;
}

export interface Frame extends BaseFrame {
  chunks: Chunk[];
  deadNodes: number[];
  /** node that failed in this step, -1 none */
  justFailed: number;
  alive: number;
  readable: boolean;
  lost: boolean;
  repairMB: number;
}

export function simulate({ scheme, repair, seed }: Params): Frame[] {
  const info = schemeInfo(scheme);
  const n = info.k + info.m;
  const frames: Frame[] = [];
  // chunk i is placed on node i (spread across 12 nodes in 3 racks / AZs)
  const placement = Array.from({ length: n }, (_, i) => Math.round((i * NODES) / n));
  const chunks: Chunk[] = Array.from({ length: n }, (_, i) => ({
    name: info.replicated ? `copy ${i + 1}` : i < info.k ? `D${i + 1}` : `P${i - info.k + 1}`,
    parity: !info.replicated && i >= info.k,
    node: placement[i],
    alive: true,
    rebuilt: false,
  }));
  const dead = new Set<number>();
  let repairMB = 0;
  const snap = (caption: string, justFailed = -1, predict?: string) => {
    const alive = chunks.filter((c) => c.alive).length;
    frames.push({
      caption,
      predict,
      chunks: chunks.map((c) => ({ ...c })),
      deadNodes: [...dead],
      justFailed,
      alive,
      readable: alive >= info.k,
      lost: alive < info.k,
      repairMB,
    });
  };

  snap(
    info.replicated
      ? `Write ${OBJECT_MB} MB: store 3 full copies on 3 nodes in different racks. Raw usage ${rawMB(scheme)} MB (${overheadPct(scheme)}% overhead). A normal read touches 1 node.`
      : `Write ${OBJECT_MB} MB: split into ${info.k} data chunks of ${info.chunkMB} MB, compute ${info.m} Reed–Solomon parity chunks, place all ${n} on different nodes. Raw usage ${rawMB(scheme)} MB (${overheadPct(scheme)}% overhead). A normal read touches ${info.k} nodes: tail latency = slowest of ${info.k}.`,
    -1,
    `How many node failures can this object survive, and what does each repair cost?`,
  );

  // failures hit the chunk-holding nodes in a seeded order
  const holders = order(seed).filter((nd) => chunks.some((c) => c.node === nd));
  const failures = repair ? Math.min(holders.length, info.m + 2) : info.m + 1;
  let happened = 0;
  for (let f = 0; f < failures; f++) {
    happened++;
    const node = repair ? holders[f % holders.length] : holders[f];
    dead.add(node);
    const victim = chunks.find((c) => c.node === node && c.alive)!;
    victim.alive = false;
    const alive = chunks.filter((c) => c.alive).length;
    const ok = alive >= info.k;
    if (!ok) {
      snap(
        `Node ${node + 1} dies → ${victim.name} gone. Only ${alive} chunk${alive === 1 ? '' : 's'} left but ${info.k} are needed: the object is LOST. ${info.replicated ? '3 copies survive' : `${info.k}+${info.m} survives`} at most ${info.m} overlapping failures; failure ${info.m + 1} before repair finishes is data loss.`,
        node,
      );
      break;
    }
    snap(
      `Node ${node + 1} dies → ${victim.name} lost. ${alive}/${n} chunks remain (need ${info.k}). ` +
        (info.replicated
          ? 'Reads go to another copy: no decoding.'
          : victim.parity
            ? 'Only parity was lost: reads are unaffected.'
            : `Degraded read: fetch ${info.k} surviving chunks and decode ${victim.name} on the fly.`) +
        (repair ? '' : ` Can survive ${alive - info.k} more.`),
      node,
    );
    if (repair) {
      // re-create the chunk on a fresh node
      // prefer a spare node; if none is left, the failed node's disk is swapped and reused
      let free = Array.from({ length: NODES }, (_, i) => i).find((i) => !dead.has(i) && !chunks.some((c) => c.node === i && c.alive));
      if (free === undefined) {
        free = node;
        dead.delete(node);
      }
      victim.node = free;
      victim.alive = true;
      victim.rebuilt = true;
      repairMB += repairReadMB(scheme);
      snap(
        `Repair: ${info.replicated ? `copy a surviving replica (${info.chunkMB} MB read)` : `read ${info.k} surviving chunks (${info.k} × ${info.chunkMB} = ${repairReadMB(scheme)} MB) to rebuild one ${info.chunkMB} MB chunk ${victim.name} (${info.k}× read amplification)`} onto node ${free + 1}${free === node ? ' (failed disk swapped)' : ''}. Back to ${n}/${n}. Durability depends on finishing this before ${info.m} more failures land: fast repair matters as much as copy count. Repair traffic so far ${repairMB} MB.`,
      );
    }
  }
  const last = frames[frames.length - 1];
  if (!last.lost) {
    snap(
      `Survived ${happened} failures because each was repaired before the next one. Summary: ${info.label} stores ${rawMB(scheme)} MB for ${OBJECT_MB} MB (${overheadPct(scheme)}% overhead)${info.nines ? `, ${info.nines} durability` : ''}, repair reads ${repairReadMB(scheme)} MB per lost chunk.`,
    );
  }
  return frames;
}
