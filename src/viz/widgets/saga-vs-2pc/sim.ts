// Pure simulation: one checkout across Order, Inventory and Payment, run either as
// two-phase commit (prepare → vote → decide) or as an orchestrated saga (local commits +
// compensations in reverse order). No React here so it can be tested with Node.
import type { BaseFrame } from '../../core';

export type Protocol = '2pc' | 'saga';
export type FailAt = 'none' | 'inventory' | 'payment' | 'confirm';

export interface Params {
  protocol: Protocol;
  /** which step fails; 'confirm' (after the pivot) only applies to the saga */
  fail: FailAt;
  /** coordinator / orchestrator crashes mid-way */
  crash: boolean;
}

export type Lane = 'coord' | 'order' | 'inventory' | 'payment';
export const PARTICIPANTS: Exclude<Lane, 'coord'>[] = ['order', 'inventory', 'payment'];

export type MsgKind = 'cmd' | 'ok' | 'fail' | 'comp' | 'decision';
export interface Msg {
  t: number;
  from: Lane;
  to: Lane;
  label: string;
  kind: MsgKind;
}

export type MarkKind = 'log' | 'commit' | 'abort' | 'crash' | 'recover' | 'blocked' | 'gap';
export interface Mark {
  t: number;
  lane: Lane;
  label: string;
  kind: MarkKind;
}

export type SpanKind = 'lock' | 'doubt' | 'down';
export interface Span {
  lane: Lane;
  from: number;
  /** null while still open; renderers close it at the frame's tick */
  to: number | null;
  kind: SpanKind;
}

export type Tone = 'idle' | 'busy' | 'good' | 'bad' | 'warn';
export interface LaneStatus {
  text: string;
  tone: Tone;
}

export interface Frame extends BaseFrame {
  tick: number;
  msgs: Msg[];
  marks: Mark[];
  spans: Span[];
  status: Record<Lane, LaneStatus>;
  /** checkout outcome so far */
  outcome: 'running' | 'committed' | 'aborted' | 'compensated';
}

const NAME: Record<Lane, string> = { coord: 'Coordinator', order: 'Order', inventory: 'Inventory', payment: 'Payment' };

function listNames(lanes: Lane[]): string {
  const n = lanes.map((l) => NAME[l]);
  return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

function makeBuilder() {
  const msgs: Msg[] = [];
  const marks: Mark[] = [];
  const spans: Span[] = [];
  const status: Record<Lane, LaneStatus> = {
    coord: { text: 'idle', tone: 'idle' },
    order: { text: 'idle', tone: 'idle' },
    inventory: { text: 'idle', tone: 'idle' },
    payment: { text: 'idle', tone: 'idle' },
  };
  const frames: Frame[] = [];
  let tick = 0;
  let outcome: Frame['outcome'] = 'running';
  return {
    get tick() {
      return tick;
    },
    advance(n = 1) {
      tick += n;
    },
    msg(from: Lane, to: Lane, label: string, kind: MsgKind) {
      msgs.push({ t: tick, from, to, label, kind });
    },
    mark(lane: Lane, label: string, kind: MarkKind) {
      marks.push({ t: tick, lane, label, kind });
    },
    open(lane: Lane, kind: SpanKind) {
      spans.push({ lane, from: tick, to: null, kind });
    },
    close(lane: Lane, kind?: SpanKind) {
      for (const s of spans) if (s.lane === lane && s.to === null && (!kind || s.kind === kind)) s.to = tick;
    },
    isOpen(lane: Lane, kind: SpanKind) {
      return spans.some((s) => s.lane === lane && s.to === null && s.kind === kind);
    },
    set(lane: Lane, text: string, tone: Tone) {
      status[lane] = { text, tone };
    },
    done(o: Frame['outcome']) {
      outcome = o;
    },
    snap(caption: string, predict?: string) {
      frames.push({
        tick,
        msgs: msgs.map((m) => ({ ...m })),
        marks: marks.map((m) => ({ ...m })),
        spans: spans.map((s) => ({ ...s })),
        status: { coord: { ...status.coord }, order: { ...status.order }, inventory: { ...status.inventory }, payment: { ...status.payment } },
        outcome,
        caption,
        predict,
      });
    },
    frames,
  };
}

// ---------------------------------------------------------------- two-phase commit
function twoPhase(fail: FailAt, crash: boolean): Frame[] {
  const b = makeBuilder();
  // 'confirm' has no meaning in 2PC (there is no step after the vote), treat as none
  const noVoter: Lane | null = fail === 'inventory' ? 'inventory' : fail === 'payment' ? 'payment' : null;
  const why: Record<Lane, string> = { coord: '', order: 'order row', inventory: 'stock row for SKU-42', payment: 'funds hold on the card' };

  b.set('coord', 'begin txn T1', 'busy');
  b.mark('coord', 'log BEGIN', 'log');
  b.snap('Two-phase commit: the coordinator starts checkout T1 across Order, Inventory and Payment. Nothing is decided until every participant has voted.');

  b.advance();
  for (const p of PARTICIPANTS) b.msg('coord', p, 'PREPARE', 'cmd');
  b.set('coord', 'waiting for 3 votes', 'busy');
  b.snap(
    'Phase 1: PREPARE goes to all 3 participants.',
    'What must each participant do before it is allowed to vote YES?',
  );

  const yes: Lane[] = [];
  for (const p of PARTICIPANTS) {
    b.advance();
    if (p === noVoter) {
      b.msg(p, 'coord', 'VOTE NO', 'fail');
      b.mark(p, 'local abort', 'abort');
      b.set(p, 'voted NO · rolled back', 'bad');
      b.snap(
        `${NAME[p]} votes NO (${p === 'inventory' ? 'SKU-42 is out of stock' : 'the card is declined'}). A NO voter may abort on its own straight away; it holds no locks.`,
        p === 'payment' && crash
          ? 'All votes are in. Suppose the coordinator crashes now, before it logs a decision. What can the YES voters do with their locks?'
          : undefined,
      );
    } else {
      b.open(p, 'lock');
      b.msg(p, 'coord', 'VOTE YES', 'ok');
      b.set(p, 'prepared · LOCKED', 'warn');
      yes.push(p);
      b.snap(
        `${NAME[p]} fsyncs its prepare record, locks the ${why[p]} and votes YES. That YES is a promise: from now on it can neither commit nor abort by itself.`,
        p === 'payment' && crash
          ? 'All votes are in. Suppose the coordinator crashes now, before it logs a decision. What can the YES voters do with their locks?'
          : undefined,
      );
    }
  }

  // contention: another checkout bumps into a held lock
  const victim = (['inventory', 'payment', 'order'] as Lane[]).find((l) => yes.includes(l));

  if (crash) {
    b.advance();
    b.mark('coord', 'CRASH', 'crash');
    b.open('coord', 'down');
    b.set('coord', 'DOWN · no decision', 'bad');
    for (const p of yes) {
      b.close(p, 'lock');
      b.open(p, 'doubt');
      b.set(p, 'IN DOUBT · locked', 'bad');
    }
    b.snap(
      `The coordinator crashes after collecting the votes but before logging a decision. ${yes.length} participant(s) voted YES and are now "in doubt".`,
    );

    b.advance();
    b.snap(
      `In-doubt participants cannot ask each other: the coordinator might have decided COMMIT and told nobody, or ABORT. Unilateral action could break atomicity, so ${listNames(yes)} must wait, locks still held.`,
    );

    if (victim) {
      b.advance();
      b.mark(victim, 'T2 blocked', 'blocked');
      b.snap(`Another checkout T2 needs the ${why[victim]} and blocks on ${NAME[victim]}'s lock. Every transaction touching those rows queues behind T1.`);
    }

    b.advance(3);
    b.mark('coord', '… minutes to hours …', 'gap');
    b.snap('Time passes: minutes to hours while someone restarts the coordinator. The locks are held the whole time. This is why 2PC is called a blocking protocol.');

    b.advance();
    b.close('coord', 'down');
    b.mark('coord', 'recover: no COMMIT in log', 'recover');
    b.mark('coord', 'log ABORT', 'log');
    b.set('coord', 'recovered · ABORT', 'warn');
    b.snap('The coordinator restarts and reads its log. It finds no COMMIT record, so it must abort T1 (presumed abort) even though everyone voted YES.');

    b.advance();
    for (const p of yes) b.msg('coord', p, 'ABORT', 'decision');
    b.snap(`Phase 2 finally runs: ABORT goes to the ${yes.length} in-doubt participant(s).`);

    b.advance();
    for (const p of yes) {
      b.close(p, 'doubt');
      b.msg(p, 'coord', 'ACK', 'ok');
      b.mark(p, 'rollback', 'abort');
      b.set(p, 'rolled back · unlocked', 'idle');
    }
    if (victim) b.set(victim, 'rolled back · T2 runs', 'idle');
    b.done('aborted');
    b.set('coord', 'T1 aborted', 'bad');
    b.snap('Participants roll back, release their locks and ACK. T2 is unblocked at last. The customer got no order, and nothing else could touch those rows during the outage.');

    b.advance();
    b.snap(
      'Summary: 2PC kept atomicity (nothing half-committed) but blocked. In-doubt locks lived as long as the coordinator outage. Real systems make the coordinator highly available (Spanner runs it on Paxos/Raft groups) or avoid 2PC across services.',
    );
    return b.frames;
  }

  if (victim) {
    b.advance();
    b.mark(victim, 'T2 waits', 'blocked');
    b.snap(
      `Meanwhile another checkout T2 for the same SKU waits on ${NAME[victim]}'s lock. Locks are held across network round trips, so the slowest participant sets everyone's latency.`,
      'The coordinator now has every vote. What does it do before telling anyone the result?',
    );
  }

  b.advance();
  const decision = noVoter ? 'ABORT' : 'COMMIT';
  b.mark('coord', `log ${decision}`, 'log');
  b.set('coord', `decided ${decision}`, noVoter ? 'bad' : 'good');
  b.snap(
    noVoter
      ? `One NO vote is enough: the coordinator durably logs ABORT. All-or-nothing means nothing.`
      : 'All 3 voted YES, so the coordinator durably logs COMMIT. This fsync is the commit point: from here, T1 commits even if the coordinator crashes and restarts.',
  );

  b.advance();
  for (const p of yes) b.msg('coord', p, decision, 'decision');
  b.snap(`Phase 2: ${decision} goes to the ${yes.length} participant(s) that voted YES. The coordinator retries until every one ACKs.`);

  for (const p of yes) {
    b.advance();
    b.close(p, 'lock');
    b.msg(p, 'coord', 'ACK', 'ok');
    b.mark(p, noVoter ? 'rollback' : 'commit', noVoter ? 'abort' : 'commit');
    b.set(p, noVoter ? 'rolled back · unlocked' : 'committed · unlocked', noVoter ? 'idle' : 'good');
    if (p === victim) b.mark(p, 'T2 proceeds', 'blocked');
    b.snap(`${NAME[p]} ${noVoter ? 'rolls back' : 'commits'}, releases its locks and ACKs.${p === victim ? ' T2 can finally take the lock.' : ''}`);
  }

  b.advance();
  b.mark('coord', 'log END', 'log');
  b.done(noVoter ? 'aborted' : 'committed');
  b.set('coord', noVoter ? 'T1 aborted' : 'T1 committed', noVoter ? 'bad' : 'good');
  b.snap(
    noVoter
      ? 'All ACKs in: T1 aborted atomically, so no participant kept any change. Cost: 2 round trips plus several fsyncs, with locks held throughout.'
      : `All ACKs in: T1 committed atomically on all 3 services. Cost: 2 round trips, several fsyncs, and locks held from the vote until the decision arrived.`,
  );
  b.advance();
  b.snap('Summary: 2PC gives atomicity and isolation through locks, but needs every participant to speak XA, and it blocks if the coordinator dies. Turn on "coordinator crash" to see that.');
  return b.frames;
}

// ---------------------------------------------------------------- orchestrated saga
interface Step {
  lane: Lane;
  cmd: string;
  done: string;
  comp?: string;
  compDone?: string;
  kind: 'compensatable' | 'pivot' | 'retriable';
}

const STEPS: Step[] = [
  { lane: 'order', cmd: 'createOrder', done: 'order #42 PENDING', comp: 'cancelOrder', compDone: 'order #42 CANCELLED', kind: 'compensatable' },
  { lane: 'inventory', cmd: 'reserve(SKU-42)', done: '1 unit reserved', comp: 'release(SKU-42)', compDone: 'reservation released', kind: 'compensatable' },
  { lane: 'payment', cmd: 'charge $80', done: '$80 captured', kind: 'pivot' },
  { lane: 'order', cmd: 'confirmOrder', done: 'order #42 CONFIRMED', kind: 'retriable' },
];

function saga(fail: FailAt, crash: boolean): Frame[] {
  const b = makeBuilder();
  const failIdx = fail === 'inventory' ? 1 : fail === 'payment' ? 2 : fail === 'confirm' ? 3 : -1;
  const completed: number[] = [];

  b.set('coord', 'saga 42 STARTED', 'busy');
  b.mark('coord', 'persist STARTED', 'log');
  b.snap(
    'Orchestrated saga: the orchestrator persists a saga row, then runs 4 local transactions in order: createOrder → reserve stock → charge (the pivot) → confirm.',
  );

  let crashed = false;
  for (let i = 0; i < STEPS.length; i++) {
    const s = STEPS[i];
    const key = `saga42:${i + 1}`;
    b.advance();
    b.msg('coord', s.lane, s.cmd, 'cmd');
    b.set('coord', `step ${i + 1}: ${s.cmd}`, 'busy');
    const pivotNote = s.kind === 'pivot' ? ' This is the pivot: if it succeeds, the saga must run to completion.' : '';
    b.snap(`Step ${i + 1} (${s.kind}): command ${s.cmd} goes to ${NAME[s.lane]} with idempotency key ${key}.${pivotNote}`,
      i === failIdx && fail !== 'confirm' && completed.length > 0
        ? `${NAME[s.lane]} is about to reject this step. Which earlier steps must be undone, and in what order?`
        : undefined);

    b.advance();
    if (i === failIdx && fail === 'confirm') {
      b.msg(s.lane, 'coord', 'timeout', 'fail');
      b.set(s.lane, 'confirm timed out', 'warn');
      b.snap(
        `Step 4 times out: the outcome is unknown. Payment has already been captured, so the saga is past the pivot.`,
        'Should the orchestrator now refund the payment and cancel the order?',
      );
      b.advance();
      b.msg('coord', s.lane, `${s.cmd} (retry)`, 'cmd');
      b.snap(`No. After the pivot, steps are retriable, not compensated. The orchestrator re-sends ${s.cmd} with the same key ${key}, so a duplicate has no extra effect.`);
      b.advance();
    }
    if (i === failIdx && fail !== 'confirm') {
      b.msg(s.lane, 'coord', s.lane === 'inventory' ? 'FAIL: out of stock' : 'FAIL: declined', 'fail');
      b.mark(s.lane, 'nothing committed', 'abort');
      b.set(s.lane, s.lane === 'inventory' ? 'rejected: out of stock' : 'rejected: card declined', 'bad');
      b.snap(
        `${NAME[s.lane]} rejects step ${i + 1} (${s.lane === 'inventory' ? 'out of stock' : 'card declined'}). Its own local transaction rolled back, so there is nothing to undo there.`,
      );
      b.advance();
      b.set('coord', 'COMPENSATING', 'warn');
      b.mark('coord', 'persist COMPENSATING', 'log');
      b.snap(
        `The orchestrator persists status COMPENSATING before doing anything else, so a crash cannot forget the decision. ` +
          (completed.length
            ? `${completed.length} earlier step(s) already committed: ${completed.map((j) => STEPS[j].done).join(', ')}.`
            : 'No earlier step committed.'),
      );
    } else {
      b.msg(s.lane, 'coord', 'OK', 'ok');
      b.mark(s.lane, 'local commit', 'commit');
      b.set(s.lane, s.done, s.kind === 'compensatable' && i === 0 ? 'warn' : 'good');
      b.mark('coord', `persist step ${i + 1} done`, 'log');
      completed.push(i);
      b.snap(
        `${NAME[s.lane]} commits locally (${s.done}) and replies OK. Its locks were held only for this local transaction, not across the network. The orchestrator persists "step ${i + 1} done".`,
        i === 0 ? 'Order #42 is committed as PENDING while the saga is still running. Can other requests see it?' : undefined,
      );
      if (i === 0) {
        b.advance();
        b.mark('order', 'others see PENDING', 'blocked');
        b.snap(
          'No isolation: other requests can already see order #42 as PENDING. The status works as a semantic lock (for example, a PENDING order cannot ship), which is the saga\'s answer to missing isolation.',
        );
      }
    }

    // orchestrator crash right after step 2's outcome is persisted
    if (crash && !crashed && i === 1) {
      crashed = true;
      b.advance();
      b.mark('coord', 'CRASH', 'crash');
      b.open('coord', 'down');
      b.set('coord', 'DOWN · state persisted', 'bad');
      b.snap(
        'The orchestrator crashes. Unlike 2PC, no participant is in doubt and no lock is held: each step already committed or failed locally. The order just stays PENDING.',
        'A new orchestrator instance starts. How does it know where to continue?',
      );
      b.advance(3);
      b.mark('coord', '… restart …', 'gap');
      b.close('coord', 'down');
      b.mark('coord', 'resume from saga row', 'recover');
      b.set('coord', i === failIdx ? 'resumed: COMPENSATING' : 'resumed at step 3', 'busy');
      b.snap(
        `Another instance loads saga 42's persisted row (last completed: step ${completed.length ? completed[completed.length - 1] + 1 : 0}) and continues. Commands re-use deterministic keys like saga42:3, so re-sending one is safe.`,
      );
    }

    if (i === failIdx && fail !== 'confirm') {
      // compensate in reverse order
      const toUndo = [...completed].reverse();
      for (const j of toUndo) {
        const c = STEPS[j];
        b.advance();
        b.msg('coord', c.lane, c.comp!, 'comp');
        b.snap(`Compensation for step ${j + 1}: ${c.comp} goes to ${NAME[c.lane]}. Compensations run in reverse order of the completed steps.`);
        b.advance();
        b.msg(c.lane, 'coord', 'OK', 'ok');
        b.mark(c.lane, 'compensated', 'abort');
        b.set(c.lane, c.compDone!, 'idle');
        b.mark('coord', `persist C${j + 1} done`, 'log');
        b.snap(
          `${NAME[c.lane]} commits a new local transaction (${c.compDone}). This is a semantic undo, not a rollback, and it must be idempotent because it may be retried.`,
        );
      }
      b.advance();
      b.done('compensated');
      b.set('coord', 'saga 42 COMPENSATED', 'bad');
      b.mark('coord', 'persist COMPENSATED', 'log');
      b.snap(
        toUndo.length
          ? `Saga ended COMPENSATED: ${toUndo.map((j) => STEPS[j].comp).join(' → ')} ran in reverse order. The system is consistent again, but other readers briefly saw the intermediate states.`
          : 'Saga ended: the first step failed, so there was nothing to compensate.',
      );
      if (fail === 'inventory') {
        b.advance();
        b.snap(
          'Step order paid off: the risky stock check ran before the payment, so no money moved and no refund was needed. Put the steps most likely to fail first, and the pivot last.',
        );
      }
      b.advance();
      b.snap(
        'Summary: a saga never holds locks across services, and a crash only pauses it. You pay with no isolation and must write a compensation for every step before the pivot.' +
          (crash ? '' : ' Turn on the crash to see a saga pause and resume.'),
      );
      return b.frames;
    }
  }

  b.advance();
  b.done('committed');
  b.set('coord', 'saga 42 COMPLETED', 'good');
  b.mark('coord', 'persist COMPLETED', 'log');
  b.snap(
    `Saga COMPLETED: 4 local commits, 0 compensations${fail === 'confirm' ? ', 1 idempotent retry after the pivot' : ''}${crash ? ', and 1 crash survived by resuming from persisted state' : ''}.`,
    'How many locks were held across the network during this whole saga?',
  );
  b.advance();
  b.snap(
    'Summary: zero. Each service committed on its own, so no locks crossed the network. You pay with no isolation (PENDING was visible) and need compensations. Pick "Payment" as the failing step to watch them run in reverse.',
  );
  return b.frames;
}

export function simulate({ protocol, fail, crash }: Params): Frame[] {
  return protocol === '2pc' ? twoPhase(fail === 'confirm' ? 'none' : fail, crash) : saga(fail, crash);
}
