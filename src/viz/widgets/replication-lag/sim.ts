// Pure, deterministic simulation of async replication lag and read-your-writes fixes.
// One tick ≈ 100 ms. The primary commits one background transaction per tick (LSN +1);
// replica i has applied whatever the primary had `lag_i` ticks ago.
import type { BaseFrame } from '../../core';

export type Fix = 'none' | 'window' | 'lsn' | 'sync';

export interface Params {
  /** replica-1 lag in ticks (replica-2 is 2 ticks slower still) */
  lag: number;
  fix: Fix;
  /** "read from primary for N ticks after a write" */
  window: number;
}

export type NodeId = 'primary' | 'r1' | 'r2';

export interface Read {
  t: number;
  node: NodeId;
  fresh: boolean;
  /** LSN of the node that served the read */
  lsn: number;
}

export interface Frame extends BaseFrame {
  tick: number;
  /** applied LSN per node, per tick up to and including `tick` */
  lsnHistory: Record<NodeId, number>[];
  userLsn: number;
  writeTick: number;
  /** tick at which the user's commit returned (later than writeTick only with sync replication) */
  ackTick: number;
  reads: Read[];
  /** what the user is doing this tick */
  op: 'idle' | 'write' | 'commit-wait' | 'read';
  primaryReads: number;
  staleReads: number;
}

export const TICKS = 15;
export const WRITE_TICK = 2;
const BASE = 100;

export const FIX_LABELS: Record<Fix, string> = {
  none: 'no fix',
  window: 'primary for N ticks',
  lsn: 'LSN token routing',
  sync: 'sync (remote_apply)',
};

export const NODE_LABEL: Record<NodeId, string> = { primary: 'primary', r1: 'replica-1', r2: 'replica-2' };

export function lags(lag: number): Record<NodeId, number> {
  return { primary: 0, r1: lag, r2: lag + 2 };
}

/** Primary's WAL position at the end of tick t (one background commit per tick plus the user's write). */
function primaryLsn(t: number): number {
  if (t < 0) return BASE;
  return BASE + (t + 1) + (t >= WRITE_TICK ? 1 : 0);
}

export function simulate({ lag, fix, window }: Params): Frame[] {
  const L = lags(lag);
  const userLsn = primaryLsn(WRITE_TICK); // the user's write is the last record of WRITE_TICK
  const ackTick = fix === 'sync' ? WRITE_TICK + lag : WRITE_TICK;
  const frames: Frame[] = [];
  const hist: Record<NodeId, number>[] = [];
  const reads: Read[] = [];
  let primaryReads = 0;
  let staleReads = 0;
  let rr = 0; // round-robin pointer over replicas

  const applied = (node: NodeId, t: number) => primaryLsn(t - L[node]);

  frames.push({
    tick: -1,
    lsnHistory: [],
    userLsn,
    writeTick: WRITE_TICK,
    ackTick,
    reads: [],
    op: 'idle',
    primaryReads: 0,
    staleReads: 0,
    caption: `The primary streams its WAL asynchronously: replica-1 replays ${lag} tick${lag === 1 ? '' : 's'} behind, replica-2 ${L.r2} behind. Reads are load-balanced across replicas. Fix: ${FIX_LABELS[fix]}${fix === 'window' ? ` (N=${window})` : ''}.`,
  });

  for (let t = 0; t < TICKS; t++) {
    const row = { primary: applied('primary', t), r1: applied('r1', t), r2: applied('r2', t) };
    hist.push(row);
    let op: Frame['op'] = 'idle';
    let caption = '';
    let read: Read | undefined;

    if (t < WRITE_TICK) {
      caption = `t=${t}: other users commit; the primary is at LSN ${row.primary}, replica-1 at ${row.r1}, replica-2 at ${row.r2}.`;
    } else if (t === WRITE_TICK) {
      op = fix === 'sync' && ackTick > t ? 'commit-wait' : 'write';
      caption =
        fix === 'sync'
          ? `t=${t}: the user renames "Ana" → "Ann" (LSN ${userLsn}). With synchronous_commit = remote_apply, the commit waits until replica-1 has APPLIED it${lag ? `: ${lag} tick${lag === 1 ? '' : 's'} of extra commit latency` : ''}.`
          : `t=${t}: the user renames "Ana" → "Ann". The primary commits it at LSN ${userLsn} and returns at once; replicas get it ${lag} and ${L.r2} ticks later.${fix === 'lsn' ? ` The app hands the client causal token LSN ${userLsn}.` : ''}${fix === 'window' ? ` The session records last_write_at = t${t}.` : ''}`;
    } else if (t < ackTick) {
      op = 'commit-wait';
      caption = `t=${t}: the user is still waiting for the commit (replica-1 at LSN ${row.r1} < ${userLsn}). Every write pays this, not just this user's.`;
    } else {
      op = 'read';
      // routing decision
      let node: NodeId;
      let why: string;
      const replicas: NodeId[] = ['r2', 'r1']; // the balancer happens to start with the slower replica
      if (fix === 'window' && t - WRITE_TICK < window) {
        node = 'primary';
        why = `wrote ${t - WRITE_TICK} tick${t - WRITE_TICK === 1 ? '' : 's'} ago < N=${window}, so it is routed to the primary`;
      } else if (fix === 'lsn') {
        const order = [replicas[rr % 2], replicas[(rr + 1) % 2]];
        const ok = order.find((r) => row[r] >= userLsn);
        if (ok) {
          node = ok;
          why = `token ${userLsn} ≤ ${NODE_LABEL[ok]}'s replay LSN ${row[ok]}, so ${NODE_LABEL[ok]} may serve it`;
          rr++;
        } else {
          node = 'primary';
          why = `no replica has replayed LSN ${userLsn} yet (r1 ${row.r1}, r2 ${row.r2}), so it falls back to the primary`;
        }
      } else if (fix === 'sync') {
        node = 'r1';
        why = 'routed to the synchronous standby replica-1';
      } else {
        node = replicas[rr % 2];
        rr++;
        why = fix === 'window' ? `the ${window}-tick window is over, so it is load-balanced to ${NODE_LABEL[node]}` : `load-balanced to ${NODE_LABEL[node]}`;
      }
      const lsn = row[node];
      const fresh = lsn >= userLsn;
      read = { t, node, fresh, lsn };
      reads.push(read);
      if (node === 'primary') primaryReads++;
      if (!fresh) staleReads++;
      const prevFresh = reads.length > 1 ? reads[reads.length - 2].fresh : undefined;
      const backwards = prevFresh === true && !fresh;
      caption = `t=${t}: the user refreshes: ${why}. ${NODE_LABEL[node]} is at LSN ${lsn} ${fresh ? `≥ ${userLsn}` : `< ${userLsn}`}, so they see ${fresh ? '"Ann" ✓' : '"Ana": their save looks lost ✗'}${backwards ? ' (and time went BACKWARDS from the previous refresh: a monotonic-reads violation)' : ''}.`;
    }

    frames.push({
      tick: t,
      lsnHistory: hist.map((h) => ({ ...h })),
      userLsn,
      writeTick: WRITE_TICK,
      ackTick,
      reads: reads.map((r) => ({ ...r })),
      op,
      primaryReads,
      staleReads,
      caption,
    });
  }

  // prediction prompts: before the first read, and before any read whose outcome or route class changes
  const readFrames = frames.filter((f) => f.op === 'read');
  const firstRead = readFrames[0];
  const idx = (f: Frame) => frames.indexOf(f);
  if (firstRead) {
    frames[idx(firstRead) - 1].predict = `The user refreshes next tick. Their write is LSN ${userLsn}; replica-1 is ${lag} and replica-2 ${L.r2} ticks behind${fix === 'none' ? '' : `, and the fix is "${FIX_LABELS[fix]}"`}. Which name do they see?`;
  }
  for (let k = 1; k < readFrames.length; k++) {
    const a = readFrames[k - 1].reads.at(-1)!;
    const b = readFrames[k].reads.at(-1)!;
    const classChange = (a.node === 'primary') !== (b.node === 'primary');
    if (a.fresh !== b.fresh || classChange) {
      const at = idx(readFrames[k]) - 1;
      const prev = frames[at];
      const crowded = frames[at - 1]?.predict || frames.filter((f) => f.predict).length >= 3;
      if (!prev.predict && !crowded)
        prev.predict =
          fix === 'window' && classChange && a.node === 'primary'
            ? `The ${window}-tick primary window ends next tick, and replica-2 is ${L.r2} ticks behind. Is the window long enough?`
            : fix === 'lsn' && classChange
              ? `The next read carries token ${userLsn} again. Where will the router send it now?`
              : `Next refresh goes to ${NODE_LABEL[b.node]}. Same result as this one?`;
    }
  }
  if (frames.filter((f) => f.predict).length < 2) {
    const target = fix === 'sync' ? frames[WRITE_TICK] : readFrames[readFrames.length - 2] ?? frames[frames.length - 2];
    const at = idx(target);
    if (!frames[at].predict)
      frames[at].predict =
        fix === 'sync'
          ? `The user saves next tick with synchronous_commit = remote_apply on replica-1. How long will the commit take, and would reads on replica-2 be safe?`
          : `Will any later refresh show the old name again?`;
  }

  const last = frames[frames.length - 1];
  const summary: Record<Fix, string> = {
    none: `Summary: ${staleReads} of ${reads.length} refreshes showed the old name. Async replicas are stale by design; read-your-writes needs a routing rule.`,
    window: `Summary: ${staleReads} stale of ${reads.length}, ${primaryReads} read${primaryReads === 1 ? '' : 's'} on the primary. The window must exceed the worst replica's lag (${L.r2} ticks), and a cookie-based window does not cover the user's other devices.`,
    lsn: `Summary: ${staleReads} stale of ${reads.length}; only ${primaryReads} read${primaryReads === 1 ? '' : 's'} hit the primary. Precise and cheap on the primary, but every read path must carry the token.`,
    sync: `Summary: ${staleReads} stale of ${reads.length}, but the commit took ${lag} extra tick${lag === 1 ? '' : 's'}, for every writer. Only reads on the sync standby are safe; replica-2 is still async.`,
  };
  last.caption = `${last.caption} ${summary[fix]}`;
  return frames;
}
