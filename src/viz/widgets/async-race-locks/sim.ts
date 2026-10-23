// Pure simulation of two async requests sharing in-memory state on one Node event loop.
// A task runs synchronously until its next `await`; only then can the other task run. That
// is enough to reproduce the topic's bugs (check-then-act across an await, A→B / B→A lock
// deadlock) and its fixes (no await in the critical section, per-entity mutex, lock ordering,
// withTimeout). No React here so the interleavings can be checked with Node.
import type { BaseFrame } from '../../core';

export type Scenario = 'debit' | 'transfer';
export type Fix = 'none' | 'sync' | 'mutex' | 'unordered' | 'ordered';

export interface Params {
  scenario: Scenario;
  fix: Fix;
}

export const LOCK_TIMEOUT = 4; // ticks: withTimeout(new Mutex(), 2_000) at 0.5 s per tick

type Store = Record<string, number>;
const money = (v: number) => (v < 0 ? `−₹${-v}` : `₹${v}`);
const show = (s: Store) =>
  Object.entries(s)
    .map(([k, v]) => `${k}=${money(v)}`)
    .join(', ');
type Op =
  | { k: 'check'; label: string; ok: (s: Store) => boolean; err: string }
  | { k: 'write'; label: string; run: (s: Store) => void }
  | { k: 'await'; label: string; dur: number }
  | { k: 'lock'; label: string; lock: string }
  | { k: 'unlock'; label: string; lock: string };

export type TaskStatus = 'ready' | 'running' | 'awaiting' | 'blocked' | 'done' | 'error';

export interface TaskView {
  name: string;
  title: string;
  ops: { label: string; kind: Op['k'] }[];
  /** index of the next op to run (ops.length when finished) */
  pc: number;
  status: TaskStatus;
  note: string;
}

export interface Frame extends BaseFrame {
  now: number;
  /** which task the event loop is executing in this step (null = idle, waiting for timers) */
  cpu: string | null;
  tasks: TaskView[];
  store: Store;
  locks: Record<string, { owner: string | null; waiters: string[] }>;
  /** op just executed: [task index, op index] */
  last: [number, number] | null;
  outcome: 'running' | 'ok' | 'bug' | 'error';
}

interface Task {
  name: string;
  title: string;
  ops: Op[];
  pc: number;
  status: TaskStatus;
  wakeAt: number;
  blockedSince: number;
  held: string[];
  note: string;
}

function buildTasks(p: Params): { tasks: Task[]; store: Store; locks: string[]; intro: string } {
  const mk = (name: string, title: string, ops: Op[]): Task => ({
    name,
    title,
    ops,
    pc: 0,
    status: 'ready',
    wakeAt: 0,
    blockedSince: 0,
    held: [],
    note: 'queued',
  });
  if (p.scenario === 'debit') {
    const check: Op = { k: 'check', label: 'if balance < 70 throw', ok: (s) => s.W >= 70, err: 'insufficient funds' };
    const journal: Op = { k: 'await', label: 'await journal.write()', dur: 2 };
    const write: Op = { k: 'write', label: 'balance -= 70', run: (s) => void (s.W -= 70) };
    const ops: Op[] =
      p.fix === 'sync'
        ? [check, write, journal]
        : p.fix === 'mutex'
          ? [{ k: 'lock', label: 'await mutex(W)', lock: 'W' }, check, journal, write, { k: 'unlock', label: 'release(W)', lock: 'W' }]
          : [check, journal, write];
    return {
      tasks: [mk('R1', 'debit(W, 70)', [...ops]), mk('R2', 'debit(W, 70) — double tap', [...ops])],
      store: { W: 100 },
      locks: p.fix === 'mutex' ? ['W'] : [],
      intro:
        p.fix === 'none'
          ? 'Wallet W has ₹100. Two debit(70) requests arrive together. The check and the write are separated by an await on the journal.'
          : p.fix === 'sync'
            ? 'Same two debits, but the check and the write now run back to back with no await between them; the journal write happens after.'
            : 'Same two debits, but each runs inside a per-wallet mutex, so the await in the middle is protected.',
    };
  }
  // transfer(A→B) and transfer(B→A) with per-wallet mutexes
  const transfer = (from: string, to: string, amt: number): Op[] => {
    const [first, second] = p.fix === 'ordered' ? [from, to].sort() : [from, to];
    return [
      { k: 'lock', label: `await lock(${first})`, lock: first },
      { k: 'await', label: 'await (acquire is async)', dur: 1 },
      { k: 'lock', label: `await lock(${second})`, lock: second },
      { k: 'check', label: `if ${from} < ${amt} throw`, ok: (s) => s[from] >= amt, err: 'insufficient funds' },
      { k: 'await', label: 'await journal.write()', dur: 1 },
      { k: 'write', label: `${from} -= ${amt}; ${to} += ${amt}`, run: (s) => void ((s[from] -= amt), (s[to] += amt)) },
      { k: 'unlock', label: `release(${second})`, lock: second },
      { k: 'unlock', label: `release(${first})`, lock: first },
    ];
  };
  return {
    tasks: [mk('T1', 'transfer(A → B, 30)', transfer('A', 'B', 30)), mk('T2', 'transfer(B → A, 20)', transfer('B', 'A', 20))],
    store: { A: 100, B: 100 },
    locks: ['A', 'B'],
    intro:
      p.fix === 'ordered'
        ? 'A and B each start with ₹100. Both transfers lock the lower id first (A, then B), whichever direction they move money.'
        : 'A and B each start with ₹100. T1 locks its source A then B; T2 locks its source B then A. Every mutex is wrapped in withTimeout(2 s).',
  };
}

export function simulate(p: Params): Frame[] {
  const { tasks, store, locks: lockNames, intro } = buildTasks(p);
  const locks: Record<string, { owner: string | null; waiters: string[] }> = Object.fromEntries(lockNames.map((l) => [l, { owner: null, waiters: [] }]));
  const frames: Frame[] = [];
  let now = 0;
  let current: Task | null = null;
  let deadlockShown = false;
  const queue: Task[] = [...tasks]; // ready queue (FIFO)
  const initialTotal = Object.values(store).reduce((a, b) => a + b, 0);

  const outcome = (): Frame['outcome'] => {
    if (tasks.some((t) => t.status !== 'done' && t.status !== 'error')) return 'running';
    const total = Object.values(store).reduce((a, b) => a + b, 0);
    if (Object.values(store).some((v) => v < 0) || (p.scenario === 'transfer' && total !== initialTotal)) return 'bug';
    return tasks.some((t) => t.status === 'error' && t.note.startsWith('timeout')) ? 'error' : 'ok';
  };
  const snap = (caption: string, last: [number, number] | null, predict?: string) =>
    frames.push({
      now,
      cpu: current?.name ?? null,
      tasks: tasks.map((t) => ({
        name: t.name,
        title: t.title,
        ops: t.ops.map((o) => ({ label: o.label, kind: o.k })),
        pc: t.pc,
        status: t.status,
        note: t.note,
      })),
      store: { ...store },
      locks: Object.fromEntries(Object.entries(locks).map(([k, v]) => [k, { owner: v.owner, waiters: [...v.waiters] }])),
      last,
      outcome: outcome(),
      caption,
      predict,
    });

  const releaseAll = (t: Task) => {
    for (const l of [...t.held].reverse()) unlock(t, l);
  };
  const unlock = (t: Task, l: string) => {
    t.held = t.held.filter((x) => x !== l);
    const lk = locks[l];
    const next = lk.waiters.shift();
    lk.owner = null;
    if (next) {
      const w = tasks.find((x) => x.name === next)!;
      lk.owner = w.name;
      w.held.push(l);
      w.pc++;
      w.status = 'ready';
      w.note = `got lock ${l}`;
      queue.push(w);
    }
  };

  const predict =
    p.scenario === 'debit' && p.fix === 'none'
      ? 'Both requests will pass the balance check. What will the balance be at the end?'
      : p.scenario === 'transfer' && p.fix === 'unordered'
        ? 'T1 holds A and T2 holds B, and each will next ask for the lock the other one holds. What happens?'
        : undefined;
  snap(intro, null);

  for (let guard = 0; guard < 200; guard++) {
    if (!current) {
      // timers: wake awaiting tasks whose await finished, and fire lock timeouts
      for (const t of tasks) {
        if (t.status === 'awaiting' && t.wakeAt <= now) {
          t.status = 'ready';
          t.note = 'await resolved';
          queue.push(t);
        }
        if (t.status === 'blocked' && now - t.blockedSince >= LOCK_TIMEOUT) {
          const op = t.ops[t.pc] as Extract<Op, { k: 'lock' }>;
          locks[op.lock].waiters = locks[op.lock].waiters.filter((x) => x !== t.name);
          t.status = 'error';
          t.note = `timeout waiting for ${op.lock}`;
          const held = t.held.join(' and ');
          releaseAll(t);
          snap(
            `t=${now}: withTimeout fires: ${t.name} gave up waiting for lock ${op.lock} after 2 s and throws. runExclusive releases what it held (${held || 'nothing'}), so the bug surfaces as an error instead of a request that hangs forever.`,
            null,
          );
        }
      }
      current = queue.shift() ?? null;
      if (!current) {
        const live = tasks.filter((t) => t.status === 'awaiting' || t.status === 'blocked');
        if (!live.length) break;
        const nextWake = Math.min(
          ...live.map((t) => (t.status === 'awaiting' ? t.wakeAt : t.blockedSince + LOCK_TIMEOUT)),
        );
        const allBlocked = live.every((t) => t.status === 'blocked');
        if (allBlocked && !deadlockShown) {
          deadlockShown = true;
          snap(
            `Deadlock: ${live.map((t) => `${t.name} holds ${t.held.join(',')} and waits for ${(t.ops[t.pc] as Extract<Op, { k: 'lock' }>).lock}`).join('; ')}. The event loop is idle; no stack trace, no CPU, just hung requests.`,
            null,
          );
        }
        now = nextWake;
        continue;
      }
      current.status = 'running';
    }

    const t: Task = current;
    const ti = tasks.indexOf(t);
    const oi = t.pc;
    const op = t.ops[oi];
    if (!op) {
      t.status = 'done';
      t.note = 'returned';
      current = null;
      snap(`t=${now}: ${t.name}’s await resolves and the function returns.`, null);
      continue;
    }
    if (op.k === 'check') {
      if (!op.ok(store)) {
        t.status = 'error';
        t.note = op.err;
        releaseAll(t);
        current = null;
        snap(`t=${now}: ${t.name} checks and throws “${op.err}”. ${show(store)}.`, [ti, oi]);
        continue;
      }
      t.pc++;
      t.note = 'check passed';
      snap(`t=${now}: ${t.name} runs ${op.label}: passes (${show(store)}).`, [ti, oi], oi === 0 && t.name.endsWith('1') ? predict : undefined);
    } else if (op.k === 'write') {
      op.run(store);
      t.pc++;
      t.note = 'wrote';
      snap(`t=${now}: ${t.name} runs ${op.label} → ${show(store)}.`, [ti, oi]);
    } else if (op.k === 'await') {
      t.pc++;
      t.status = 'awaiting';
      t.wakeAt = now + op.dur;
      t.note = `awaiting until t=${now + op.dur}`;
      current = null;
      const other = tasks.find((x) => x !== t && (x.status === 'ready' || queue.includes(x)));
      snap(
        `t=${now}: ${t.name} hits ${op.label} and yields the event loop${other ? `; ${other.name} gets to run now` : ''}.${
          p.scenario === 'debit' && p.fix === 'none' && oi === 1 ? ' Its balance check is now stale.' : ''
        }`,
        [ti, oi],
        p.scenario === 'transfer' && p.fix === 'unordered' && oi === 1 && t.name === 'T2' ? predict : undefined,
      );
    } else if (op.k === 'lock') {
      const lk = locks[op.lock];
      if (lk.owner === null) {
        lk.owner = t.name;
        t.held.push(op.lock);
        t.pc++;
        t.note = `holds ${t.held.join(',')}`;
        snap(`t=${now}: ${t.name} acquires lock ${op.lock}.`, [ti, oi]);
      } else {
        lk.waiters.push(t.name);
        t.status = 'blocked';
        t.blockedSince = now;
        t.note = `waiting for ${op.lock} (held by ${lk.owner})`;
        current = null;
        snap(`t=${now}: ${t.name} wants lock ${op.lock} but ${lk.owner} holds it, so ${t.name} waits.`, [ti, oi]);
      }
    } else {
      t.pc++;
      unlock(t, op.lock);
      t.note = `released ${op.lock}`;
      snap(`t=${now}: ${t.name} releases ${op.lock}${locks[op.lock].owner ? `; ${locks[op.lock].owner} was waiting and now holds it` : ''}.`, [ti, oi]);
    }
    if (current && current.pc >= current.ops.length) {
      current.status = 'done';
      current.note = 'returned';
      current = null;
    }
  }

  const fin = outcome();
  const s = show(store);
  const lesson: Record<Fix, string> = {
    none: `Both checks saw ₹100, both writes landed: ${s}. A method is atomic only until its first await.`,
    sync: `${s}. R2’s check ran after R1’s write, so the overdraft is impossible, and it costs nothing: no lock, no deadlock risk.`,
    mutex: `${s}. R2 waited for the mutex and then saw the real balance. Use this when the await must sit between check and act, and lock per wallet, not globally.`,
    unordered: `${s}. One transfer failed with a timeout. Without withTimeout both requests would hang forever. Fix the cause: lock in a global order.`,
    ordered: `${s}; total still ₹200. Both transfers lock A first, so the second one simply waits its turn. No cycle, no deadlock.`,
  };
  snap(`${fin === 'bug' ? 'Bug: ' : fin === 'error' ? 'Surfaced error: ' : 'Correct: '}${lesson[p.fix]}`, null);
  return frames;
}
