// Pure, deterministic simulation of two requests updating one balance concurrently.
// One tick = one step of each running request (A moves before B inside a tick). The four
// strategies are the topic's fixes: none (read-modify-write), an atomic UPDATE, optimistic
// compare-and-set on a version column, and a pessimistic row lock (SELECT … FOR UPDATE).
import type { BaseFrame } from '../../core';

export type Strategy = 'naive' | 'atomic' | 'cas' | 'lock';
export type ClientId = 'A' | 'B';
export type OpKind = 'read' | 'compute' | 'write' | 'atomic' | 'cas' | 'lockread' | 'commit';

export interface Params {
  strategy: Strategy;
  /** B starts this many ticks after A */
  offset: number;
}

export const START_BALANCE = 100;
export const DELTA: Record<ClientId, number> = { A: 50, B: 30 };
export const EXPECTED = START_BALANCE + DELTA.A + DELTA.B;
export const MAX_TICKS = 14;

export const STRATEGY_LABELS: Record<Strategy, string> = {
  naive: 'read, then write',
  atomic: 'atomic UPDATE',
  cas: 'version CAS + retry',
  lock: 'SELECT … FOR UPDATE',
};

const PROGRAMS: Record<Strategy, OpKind[]> = {
  naive: ['read', 'compute', 'write'],
  atomic: ['compute', 'atomic'],
  cas: ['read', 'compute', 'cas'],
  lock: ['lockread', 'compute', 'write', 'commit'],
};

export type Outcome = 'ok' | 'lost' | 'fail' | 'wait';

export interface Cell {
  t: number;
  client: ClientId;
  /** two short lines for the timeline box */
  label: string;
  detail: string;
  outcome: Outcome;
  sql: string;
}

export interface ClientView {
  id: ClientId;
  local: number | null;
  version: number | null;
  done: boolean;
  retries: number;
  waiting: boolean;
}

export interface Frame extends BaseFrame {
  t: number;
  cells: Cell[];
  /** balance and version after each tick */
  dbHistory: { t: number; value: number; version: number; lock: ClientId | null }[];
  value: number;
  version: number;
  lock: ClientId | null;
  clients: Record<ClientId, ClientView>;
  lostUpdates: number;
  done: boolean;
}

export function simulate({ strategy, offset }: Params): Frame[] {
  const prog = PROGRAMS[strategy];
  const start: Record<ClientId, number> = { A: 0, B: offset };
  const ids: ClientId[] = ['A', 'B'];
  let value = START_BALANCE;
  let version = 1;
  let lock: ClientId | null = null;
  /** who last wrote, and from which balance they computed */
  const pc: Record<ClientId, number> = { A: 0, B: 0 };
  const clients: Record<ClientId, ClientView> = {
    A: { id: 'A', local: null, version: null, done: false, retries: 0, waiting: false },
    B: { id: 'B', local: null, version: null, done: false, retries: 0, waiting: false },
  };
  const cells: Cell[] = [];
  const dbHistory: Frame['dbHistory'] = [];
  let lostUpdates = 0;
  const frames: Frame[] = [];

  const snap = (t: number, caption: string): Frame => ({
    t,
    cells: cells.map((c) => ({ ...c })),
    dbHistory: dbHistory.map((d) => ({ ...d })),
    value,
    version,
    lock,
    clients: { A: { ...clients.A }, B: { ...clients.B } },
    lostUpdates,
    done: ids.every((id) => clients[id].done),
    caption,
  });

  frames.push(
    snap(
      -1,
      `Balance = ${START_BALANCE} (version ${version}). Request A adds ${DELTA.A}, request B adds ${DELTA.B}; the right answer is ${EXPECTED}. Strategy: ${STRATEGY_LABELS[strategy]}. B starts ${offset} tick${offset === 1 ? '' : 's'} after A.`,
    ),
  );

  for (let t = 0; t < MAX_TICKS; t++) {
    const notes: string[] = [];
    for (const id of ids) {
      const c = clients[id];
      if (c.done || t < start[id]) continue;
      const op = prog[pc[id]];
      const d = DELTA[id];
      const cell = (label: string, detail: string, outcome: Outcome, sql: string) => cells.push({ t, client: id, label, detail, outcome, sql });
      if (op === 'read') {
        c.local = value;
        c.version = version;
        cell('read', `${value}${strategy === 'cas' ? ` (v${version})` : ''}`, 'ok', strategy === 'cas' ? 'SELECT balance, version' : 'SELECT balance');
        notes.push(`${id} reads balance ${value}${strategy === 'cas' ? ` at version ${version}` : ''}.`);
        pc[id]++;
      } else if (op === 'compute') {
        const base = c.local;
        cell(base === null ? 'app work' : 'compute', base === null ? '…' : `${base}+${d}`, 'ok', 'app code');
        notes.push(base === null ? `${id} does its app work.` : `${id} computes ${base} + ${d} = ${base + d} in app memory${strategy === 'naive' ? '; the database cannot see this decision' : ''}.`);
        if (base !== null) c.local = base + d;
        pc[id]++;
      } else if (op === 'write') {
        const intended = c.local!;
        const before = value;
        const lostIt = strategy === 'naive' && intended - d !== before;
        value = intended;
        version++;
        if (lostIt) lostUpdates++;
        cell('write', String(intended), lostIt ? 'lost' : 'ok', `UPDATE … SET balance = ${intended}`);
        notes.push(
          lostIt
            ? `${id} writes ${intended}, computed from a stale read of ${intended - d}. The balance was ${before}, so the other request's update is silently overwritten: a lost update.`
            : `${id} writes ${intended}.`,
        );
        pc[id]++;
        if (strategy !== 'lock') c.done = true;
      } else if (op === 'atomic') {
        const before = value;
        value += d;
        version++;
        cell(`+${d}`, `→ ${value}`, 'ok', `UPDATE … SET balance = balance + ${d}`);
        notes.push(`${id} runs UPDATE … SET balance = balance + ${d}. The database reads and writes the row under its own row lock in one statement: ${before} → ${value}.`);
        c.done = true;
      } else if (op === 'cas') {
        const ok = version === c.version;
        if (ok) {
          value = c.local!;
          version++;
          cell(`CAS v${c.version}`, `✓ ${value}`, 'ok', `UPDATE … WHERE version = ${c.version}`);
          notes.push(`${id}: UPDATE … SET balance = ${value}, version = ${version} WHERE version = ${c.version} → 1 row. Nobody changed the row since ${id} read it.`);
          c.done = true;
        } else {
          cell(`CAS v${c.version}`, '✗ 0 rows', 'fail', `UPDATE … WHERE version = ${c.version}`);
          notes.push(`${id}: UPDATE … WHERE version = ${c.version} → 0 rows, because the row is now at version ${version}. ${id} lost the race, so it re-reads and retries instead of overwriting.`);
          c.retries++;
          pc[id] = 0;
        }
      } else if (op === 'lockread') {
        if (lock === null || lock === id) {
          lock = id;
          c.local = value;
          c.waiting = false;
          cell('lock+read', String(value), 'ok', 'SELECT … FOR UPDATE');
          notes.push(`${id} runs SELECT … FOR UPDATE: it takes the row lock and reads ${value}.`);
          pc[id]++;
        } else {
          c.waiting = true;
          cell('blocked', `${lock} holds`, 'wait', 'SELECT … FOR UPDATE');
          notes.push(`${id} runs SELECT … FOR UPDATE but ${lock} holds the row lock, so ${id} blocks until ${lock} commits.`);
        }
      } else if (op === 'commit') {
        lock = null;
        cell('COMMIT', 'unlock', 'ok', 'COMMIT');
        notes.push(`${id} commits and releases the row lock.`);
        c.done = true;
      }
    }
    dbHistory.push({ t, value, version, lock });
    frames.push(snap(t, `Tick ${t}: ${notes.join(' ') || 'nothing runs.'}`));
    if (ids.every((id) => clients[id].done)) break;
  }

  const last = frames[frames.length - 1];
  const totalRetries = clients.A.retries + clients.B.retries;
  last.caption += ` Final balance ${value}, expected ${EXPECTED}. ${
    value === EXPECTED
      ? strategy === 'naive'
        ? 'Correct this time only because the requests did not overlap: the bug is still there, waiting for the next double-click.'
        : strategy === 'cas'
          ? `Correct, at the cost of ${totalRetries} retr${totalRetries === 1 ? 'y' : 'ies'}: optimistic locking is cheap when conflicts are rare.`
          : strategy === 'lock'
            ? 'Correct: the second request waited instead of reading a value that was about to change.'
            : 'Correct: there is no read-then-write window in the application at all.'
      : `${EXPECTED - value} was lost. Neither request got an error; the bug is silent.`
  }`;

  const firstSecond = frames.findIndex((f) => f.cells.some((c) => c.client === 'B'));
  if (firstSecond > 1) {
    frames[firstSecond - 1].predict =
      strategy === 'naive'
        ? `B starts next tick while A is between its read and its write. What will B read, and what will the final balance be?`
        : strategy === 'cas'
          ? `B starts next. Both may read the same version. Who wins the compare-and-set, and what does the loser do?`
          : strategy === 'lock'
            ? `B now asks for the same row with FOR UPDATE. What happens to B until A commits?`
            : `B starts next. Can the two atomic increments interfere with each other?`;
  }
  return frames;
}
