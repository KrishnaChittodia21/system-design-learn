// Pure, deterministic simulation of two money transfers taking row locks.
// One tick = 200 ms. Each transaction runs a short program: lock-and-update its first row, do some
// app work, lock-and-update its second row, commit. A blocked transaction adds an edge to the
// wait-for graph; a cycle in that graph is a deadlock that only aborting a victim can break.
import type { BaseFrame } from '../../core';

export type Ordering = 'natural' | 'sorted';
export type Engine = 'postgres' | 'innodb';
export type TxId = 'T1' | 'T2';
export type RowId = 'A' | 'B';

export interface Params {
  ordering: Ordering;
  engine: Engine;
  /** T2 starts this many ticks after T1 */
  offset: number;
}

export const TICK_MS = 200;
export const DEADLOCK_TIMEOUT = 5; // ticks: Postgres deadlock_timeout = 1 s
export const RETRY_BACKOFF: Record<TxId, number> = { T1: 2, T2: 3 }; // jittered backoff in ticks
export const START: Record<RowId, number> = { A: 500, B: 300 };
export const MAX_TICKS = 24;

export type Op = { kind: 'lock'; row: RowId; delta: number } | { kind: 'work' } | { kind: 'commit' };

export const ORDERING_LABELS: Record<Ordering, string> = {
  natural: 'lock "from" row first',
  sorted: 'lock rows in id order',
};
export const ENGINE_LABELS: Record<Engine, string> = {
  postgres: 'Postgres (detects after 1s)',
  innodb: 'InnoDB (immediate detection)',
};

/** T1 moves 100 from A to B; T2 moves 50 from B to A. */
export function program(tx: TxId, ordering: Ordering): Op[] {
  const from: RowId = tx === 'T1' ? 'A' : 'B';
  const to: RowId = tx === 'T1' ? 'B' : 'A';
  const amount = tx === 'T1' ? 100 : 50;
  const deltas: Record<RowId, number> = { [from]: -amount, [to]: amount } as Record<RowId, number>;
  const order: RowId[] = ordering === 'sorted' ? ['A', 'B'] : [from, to];
  return [{ kind: 'lock', row: order[0], delta: deltas[order[0]] }, { kind: 'work' }, { kind: 'lock', row: order[1], delta: deltas[order[1]] }, { kind: 'commit' }];
}

export type TxStatus = 'pending' | 'running' | 'waiting' | 'aborted' | 'backoff' | 'committed';

export interface TxView {
  id: TxId;
  pc: number;
  status: TxStatus;
  waitingOn: RowId | null;
  /** tick at which the current wait began */
  waitSince: number;
  attempts: number;
  ops: Op[];
}

export interface Frame extends BaseFrame {
  t: number;
  tx: Record<TxId, TxView>;
  owner: Record<RowId, TxId | null>;
  /** current (possibly uncommitted) value of each row */
  value: Record<RowId, number>;
  committed: Record<RowId, number>;
  /** wait-for edges: waiter → holder */
  edges: { from: TxId; to: TxId; row: RowId }[];
  cycle: boolean;
  /** set on the tick a victim is aborted */
  victim: TxId | null;
  deadlocks: number;
  done: boolean;
}

export function simulate({ ordering, engine, offset }: Params): Frame[] {
  const ids: TxId[] = ['T1', 'T2'];
  const start: Record<TxId, number> = { T1: 0, T2: offset };
  const tx: Record<TxId, TxView> = {
    T1: { id: 'T1', pc: 0, status: 'pending', waitingOn: null, waitSince: 0, attempts: 1, ops: program('T1', ordering) },
    T2: { id: 'T2', pc: 0, status: 'pending', waitingOn: null, waitSince: 0, attempts: 1, ops: program('T2', ordering) },
  };
  const owner: Record<RowId, TxId | null> = { A: null, B: null };
  const value: Record<RowId, number> = { ...START };
  const committed: Record<RowId, number> = { ...START };
  const undo: Record<TxId, { row: RowId; before: number }[]> = { T1: [], T2: [] };
  const resumeAt: Record<TxId, number> = { T1: 0, T2: 0 };
  let deadlocks = 0;
  const frames: Frame[] = [];

  const edges = () =>
    ids.flatMap((id) => {
      const v = tx[id];
      if (v.status !== 'waiting' || !v.waitingOn) return [];
      const holder = owner[v.waitingOn];
      return holder && holder !== id ? [{ from: id, to: holder, row: v.waitingOn }] : [];
    });
  const hasCycle = () => {
    const e = edges();
    return e.some((a) => e.some((b) => a.from === b.to && a.to === b.from));
  };

  const snap = (t: number, caption: string, victim: TxId | null = null): Frame => ({
    t,
    tx: { T1: { ...tx.T1 }, T2: { ...tx.T2 } },
    owner: { ...owner },
    value: { ...value },
    committed: { ...committed },
    edges: edges(),
    cycle: hasCycle(),
    victim,
    deadlocks,
    done: ids.every((id) => tx[id].status === 'committed'),
    caption,
  });

  frames.push(
    snap(
      -1,
      `T1 moves 100 from A to B; T2 moves 50 from B to A. A = 500, B = 300, total 800. Ordering: ${ORDERING_LABELS[ordering]}. T2 starts ${offset * TICK_MS} ms after T1. Engine: ${ENGINE_LABELS[engine]}.`,
    ),
  );

  const abort = (id: TxId, t: number) => {
    for (const u of undo[id].reverse()) value[u.row] = u.before;
    undo[id] = [];
    (Object.keys(owner) as RowId[]).forEach((r) => {
      if (owner[r] === id) owner[r] = null;
    });
    const v = tx[id];
    v.status = 'backoff';
    v.waitingOn = null;
    v.pc = 0;
    resumeAt[id] = t + RETRY_BACKOFF[id];
    deadlocks++;
  };

  for (let t = 0; t < MAX_TICKS; t++) {
    const notes: string[] = [];
    let victim: TxId | null = null;
    for (const id of ids) {
      const v = tx[id];
      if (v.status === 'committed') continue;
      if (v.status === 'pending') {
        if (t < start[id]) continue;
        v.status = 'running';
        notes.push(`${id} BEGINs.`);
      }
      if (v.status === 'backoff') {
        if (t < resumeAt[id]) continue;
        v.status = 'running';
        v.attempts++;
        notes.push(`${id} retries the whole transaction (attempt ${v.attempts}).`);
      }
      const op = v.ops[v.pc];
      if (op.kind === 'work') {
        v.pc++;
        notes.push(`${id} does app work while holding its lock.`);
      } else if (op.kind === 'commit') {
        (Object.keys(owner) as RowId[]).forEach((r) => {
          if (owner[r] === id) {
            owner[r] = null;
            committed[r] = value[r];
          }
        });
        undo[id] = [];
        v.status = 'committed';
        v.pc++;
        notes.push(`${id} COMMITs and releases its row locks.`);
      } else {
        const holder = owner[op.row];
        if (!holder || holder === id) {
          owner[op.row] = id;
          undo[id].push({ row: op.row, before: value[op.row] });
          value[op.row] += op.delta;
          if (v.status === 'waiting') notes.push(`${id} finally gets the lock on ${op.row} after ${(t - v.waitSince) * TICK_MS} ms and updates it.`);
          else notes.push(`${id} locks row ${op.row} and updates it (${op.delta > 0 ? '+' : ''}${op.delta}).`);
          v.status = 'running';
          v.waitingOn = null;
          v.pc++;
        } else {
          if (v.status !== 'waiting') {
            v.status = 'waiting';
            v.waitingOn = op.row;
            v.waitSince = t;
            notes.push(`${id} wants row ${op.row}, but ${holder} holds it, so ${id} blocks (edge ${id} → ${holder} in the wait-for graph).`);
            if (engine === 'innodb' && hasCycle()) {
              notes.push(`InnoDB checks the wait-for graph on every lock wait and finds the cycle ${id} → ${holder} → ${id} at once: ${id} is rolled back (ERROR 1213, deadlock found).`);
              abort(id, t);
              victim = id;
            }
          } else {
            if (engine === 'postgres' && t - v.waitSince === DEADLOCK_TIMEOUT) {
              if (hasCycle()) {
                notes.push(`${id} has waited deadlock_timeout (1 s), so it runs the deadlock detector, finds the cycle and aborts itself: ERROR 40P01 deadlock detected. Its update is rolled back and its locks are released.`);
                abort(id, t);
                victim = id;
              } else {
                notes.push(`${id} has waited 1 s and runs the deadlock detector: no cycle (${holder} is not waiting on ${id}), so it keeps waiting.`);
              }
            } else {
              notes.push(`${id} is still blocked on ${op.row} (${(t - v.waitSince) * TICK_MS} ms so far).`);
            }
          }
        }
      }
    }
    const cyc = hasCycle();
    if (cyc && !victim) notes.push(engine === 'postgres' ? 'Cycle: each transaction waits for the other, and neither can ever proceed on its own.' : '');
    frames.push(snap(t, `t=${t * TICK_MS} ms. ${notes.filter(Boolean).join(' ')}`, victim));
    if (ids.every((id) => tx[id].status === 'committed')) break;
  }

  const last = frames[frames.length - 1];
  const total = committed.A + committed.B;
  last.caption += ` Final: A = ${committed.A}, B = ${committed.B}, total ${total}${total === 800 ? ' (money conserved)' : ''}. ${
    deadlocks
      ? `${deadlocks} deadlock${deadlocks === 1 ? '' : 's'} cost ${last.t * TICK_MS} ms end to end; the victim's retry made it correct, not fast.`
      : ordering === 'sorted'
        ? 'Both transactions lock A before B, so one simply queues behind the other: a wait, never a cycle.'
        : 'No deadlock this time: T2 started after T1 had already reached row B, so T2 only waited. Same code, different timing.'
  }`;

  // predictions
  const firstWait = frames.findIndex((f) => f.edges.length > 0);
  if (firstWait > 1) {
    frames[firstWait - 1].predict =
      ordering === 'natural'
        ? `Each transaction now holds one row. Next, each asks for the row the other holds. What happens?`
        : `T2 asks for row A next, which T1 already holds. Can this become a cycle?`;
  }
  const firstVictim = frames.findIndex((f) => f.victim);
  if (firstVictim > 1 && engine === 'postgres' && !frames[firstVictim - 1].predict) {
    frames[firstVictim - 1].predict = `Both have been blocked for almost 1 s (deadlock_timeout). What does Postgres do now, and to whom?`;
  }
  return frames;
}
