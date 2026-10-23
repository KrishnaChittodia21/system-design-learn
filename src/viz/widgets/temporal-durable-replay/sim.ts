// Pure, scripted model of a Temporal workflow surviving a worker crash.
// Worker A runs orderWorkflow; the service appends to the event history; A crashes (during the
// charge activity or during the 3-day timer); worker B picks up the next workflow task, REPLAYS
// the code against the history (recorded results, no re-execution) and continues. Activities are
// at-least-once, so the retried charge needs an idempotency key; changing code without patch()
// makes replay diverge from history (non-determinism error).
import type { BaseFrame } from '../../core';

export type Crash = 'none' | 'charge' | 'timer';
export type Code = 'same' | 'v2';

export interface Params {
  crash: Crash;
  idempotent: boolean;
  /** code worker B runs */
  code: Code;
}

export type EventKind = 'wf' | 'task' | 'activity' | 'timer' | 'error';
export interface HistoryEvent {
  id: number;
  type: string;
  detail: string;
  kind: EventKind;
}

export interface CodeLine {
  text: string;
  /** activity / timer name this line issues, if any */
  op?: 'reserveStock' | 'fraudCheck' | 'chargeCard' | 'sleep' | 'sendReceipt';
}

export function codeLines(version: Code, idempotent: boolean): CodeLine[] {
  const lines: CodeLine[] = [
    { text: 'export async function orderWorkflow(id: string) {' },
    { text: '  await reserveStock(id);', op: 'reserveStock' },
  ];
  if (version === 'v2') lines.push({ text: '  await fraudCheck(id); // added, no patched()', op: 'fraudCheck' });
  lines.push(
    { text: idempotent ? '  await chargeCard(id, { idempotencyKey: id });' : '  await chargeCard(id);', op: 'chargeCard' },
    { text: "  await sleep('3 days');", op: 'sleep' },
    { text: '  await sendReceipt(id);', op: 'sendReceipt' },
    { text: '}' },
  );
  return lines;
}

export type WorkerState = 'idle' | 'running' | 'replaying' | 'crashed' | 'stuck' | 'done';

export interface Frame extends BaseFrame {
  history: HistoryEvent[];
  /** which worker's code view is shown */
  worker: 'A' | 'B';
  version: Code;
  /** highlighted code line index, -1 none */
  line: number;
  workers: { A: WorkerState; B: WorkerState };
  /** history event ids being replayed in this step */
  replayed: number[];
  /** number of real charges the payment provider made */
  charges: number;
  clock: string;
  done: boolean;
}

export function simulate({ crash, idempotent, code }: Params): Frame[] {
  const frames: Frame[] = [];
  const history: HistoryEvent[] = [];
  let id = 0;
  let worker: 'A' | 'B' = 'A';
  let version: Code = 'same';
  const workers: Frame['workers'] = { A: 'running', B: 'idle' };
  let charges = 0;
  let clock = 'day 0, 10:00:00';
  const add = (type: string, detail: string, kind: EventKind) => {
    history.push({ id: ++id, type, detail, kind });
    return id;
  };
  const lineOf = (op: CodeLine['op']) => codeLines(version, idempotent).findIndex((l) => l.op === op);
  const push = (caption: string, extra: Partial<Frame> = {}) =>
    frames.push({
      caption,
      history: history.map((e) => ({ ...e })),
      worker,
      version,
      line: -1,
      workers: { ...workers },
      replayed: [],
      charges,
      clock,
      done: false,
      ...extra,
    });

  add('WorkflowExecutionStarted', 'orderWorkflow("order-123")', 'wf');
  add('WorkflowTask', 'scheduled → started → completed', 'task');
  push('The API starts workflow order-123. The service records WorkflowExecutionStarted and hands a workflow task to worker A, which polls the "orders" task queue.', {
    line: 0,
    predict: crash === 'none' ? undefined : 'Worker A is about to die mid-workflow. What does the replacement worker re-execute?',
  });

  const r1 = add('ActivityTaskScheduled', 'reserveStock', 'activity');
  add('ActivityTaskCompleted', 'reserveStock → { reserved: 2 }', 'activity');
  push(`Workflow code calls reserveStock: worker A sends a ScheduleActivityTask command, the activity runs (a side effect, on an activity worker) and its result is RECORDED in history (events ${r1}–${r1 + 1}).`, {
    line: lineOf('reserveStock'),
  });

  add('WorkflowTask', 'scheduled → started → completed', 'task');
  const c1 = add('ActivityTaskScheduled', 'chargeCard', 'activity');
  charges++;
  if (crash === 'charge') {
    workers.A = 'crashed';
    push(
      `chargeCard attempt 1 runs: the payment provider charges $42 (charge #1)… and worker A crashes before reporting completion. History stops at event ${c1}. The charge happened; Temporal does not know.`,
      { line: lineOf('chargeCard') },
    );
    clock = 'day 0, 10:00:30';
    add('ActivityTaskTimedOut', 'StartToClose 30 s → retry (attempt 2)', 'error');
    worker = 'B';
    version = code;
    workers.B = 'running';
    if (!idempotent) charges++;
    push(
      idempotent
        ? `Start-To-Close timeout (30 s) → the service retries chargeCard on worker B. Same idempotency key "order-123", so the provider returns the existing charge: still 1 charge. Activities are at-least-once; the key makes them effectively once.`
        : `Start-To-Close timeout (30 s) → the service retries chargeCard on worker B. No idempotency key: the provider sees a new request and charges AGAIN. Charges: 2. Activities are at-least-once.`,
      { line: -1 },
    );
    add('ActivityTaskCompleted', `chargeCard → { chargeId: "ch_1" }`, 'activity');
    // workflow task now goes to B: replay
  } else {
    add('ActivityTaskCompleted', 'chargeCard → { chargeId: "ch_1" }', 'activity');
    push(`chargeCard completes; result recorded. The workflow holds no state of its own outside this history.`, { line: lineOf('chargeCard') });
  }

  if (crash === 'charge') {
    const ok = code === 'same';
    // replay on B
    const replayIds = history.filter((e) => e.kind === 'activity' && e.type === 'ActivityTaskCompleted' && e.detail.startsWith('reserveStock')).map((e) => e.id);
    push(
      `Worker B gets the next workflow task. It has no memory of this workflow, so it runs orderWorkflow FROM THE TOP and replays: reserveStock finds its Completed event in history → returns { reserved: 2 } instantly, not called again.`,
      { line: lineOf('reserveStock'), replayed: [r1, ...replayIds], workers: { A: 'crashed', B: 'replaying' } },
    );
    if (!ok) {
      workers.B = 'stuck';
      add('WorkflowTaskFailed', 'NonDeterminismError: expected chargeCard, got fraudCheck', 'error');
      push(
        `Worker B runs v2 code: the next command is ScheduleActivityTask(fraudCheck), but history event ${c1} says chargeCard. Replay diverged → NonDeterminismError. The workflow task fails and retries until fixed; the workflow is stuck, not corrupted. Fix: if (patched('fraud-check')) around the new call, or a new workflow type.`,
        { line: lineOf('fraudCheck') },
      );
      return frames;
    }
    push(`chargeCard is replayed the same way: the recorded result { chargeId: "ch_1" } is returned without calling the provider. Replay of all prior steps takes milliseconds.`, {
      line: lineOf('chargeCard'),
      replayed: [c1, c1 + 2],
      workers: { A: 'crashed', B: 'replaying' },
    });
    workers.B = 'running';
  }

  add('WorkflowTask', 'scheduled → started → completed', 'task');
  const t1 = add('TimerStarted', "sleep('3 days')", 'timer');
  push(`sleep('3 days') becomes a durable timer owned by the SERVICE (event ${t1}). No worker holds a thread for 3 days; no cron, no status column.`, { line: lineOf('sleep') });

  if (crash === 'timer') {
    workers.A = 'crashed';
    push(`Worker A crashes (or is redeployed) during the 3-day wait. Nothing is lost: the timer lives in the service, the state lives in the history.`, { line: lineOf('sleep') });
    worker = 'B';
    version = code;
    workers.B = 'idle';
  }

  clock = 'day 3, 10:00:31';
  add('TimerFired', '3 days elapsed', 'timer');
  const replayer = worker;
  if (crash === 'timer') {
    if (code === 'v2') {
      workers.B = 'stuck';
      add('WorkflowTaskFailed', 'NonDeterminismError: expected chargeCard, got fraudCheck', 'error');
      push(
        `Three days later the timer fires and worker B (running v2 code) replays: reserveStock matches, but then the code schedules fraudCheck where history recorded chargeCard. NonDeterminismError: the workflow task fails and retries until a fix is deployed. Long sleeps are exactly where unversioned code changes bite; wrap the new call in patched().`,
        { line: lineOf('fraudCheck'), replayed: [r1, r1 + 1] },
      );
      return frames;
    }
    workers.B = 'replaying';
    push(
      `Three days later TimerFired. Worker B picks up the workflow task and replays from the top: reserveStock, chargeCard and the timer all match recorded events, so nothing is re-executed and no customer is charged again.`,
      { line: lineOf('sleep'), replayed: history.filter((e) => e.kind !== 'task' && e.kind !== 'wf').map((e) => e.id) },
    );
    workers.B = 'running';
  } else {
    push(`Day 3: the service fires the timer (TimerFired) and schedules a workflow task. Worker ${replayer} continues right after the await.`, { line: lineOf('sleep') });
  }

  add('WorkflowTask', 'scheduled → started → completed', 'task');
  add('ActivityTaskScheduled', 'sendReceipt', 'activity');
  add('ActivityTaskCompleted', 'sendReceipt → ok', 'activity');
  add('WorkflowExecutionCompleted', 'done', 'wf');
  workers[worker] = 'done';
  push(
    `sendReceipt runs and the workflow completes. Final: ${charges} real charge${charges === 1 ? '' : 's'} at the provider` +
      (charges > 1 ? ': the double charge came from the retried activity, not from replay. Add an idempotency key.' : '. The history IS the state: ') +
      (charges > 1 ? '' : `${history.length} events reconstruct everything, on any worker.`),
    { line: codeLines(version, idempotent).length - 1, done: true },
  );
  return frames;
}
