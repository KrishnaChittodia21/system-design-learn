// Pure tick-based model of workers claiming jobs from a durable job table (no React, Node-testable).
//   Claim  = SELECT … FOR UPDATE SKIP LOCKED on a due row (PENDING, RETRY whose next_run_at ≤ now,
//            or RUNNING whose lease expired); sets owner, lease_until = now + lease, token += 1.
//   Work   = one unit per tick; a running worker heartbeats (extends lease_until) only if it still
//            holds the current token.
//   Finish = UPDATE jobs SET status='SUCCEEDED' WHERE id=? [AND token = myToken]. With fencing the
//            stale token is rejected; without it the zombie's write lands.
//   Retry  = a transient failure sets status RETRY and next_run_at = now + BASE × 2^(attempt−1).
// Within a tick: running workers act first (work / heartbeat / write), then free workers claim.
import type { BaseFrame } from '../../core';

export interface Params {
  lease: number;
  fencing: boolean;
}

export const DEFAULT_PARAMS: Params = { lease: 2, fencing: true };

export const BACKOFF_BASE = 2;
/** W1 is frozen (stop-the-world GC) during these ticks */
export const PAUSE_FROM = 3;
export const PAUSE_TO = 6;

export type JobStatus = 'PENDING' | 'RUNNING' | 'RETRY' | 'SUCCEEDED';

export interface JobRow {
  id: string;
  status: JobStatus;
  owner: string | null;
  token: number;
  leaseUntil: number | null;
  attempts: number;
  nextRunAt: number;
  /** who wrote the stored result, in order */
  writes: string[];
  work: number;
}

export interface WorkerView {
  id: string;
  job: string | null;
  token: number;
  remaining: number;
  paused: boolean;
}

export interface WriteEvent {
  worker: string;
  job: string;
  token: number;
  accepted: boolean;
}

export interface Frame extends BaseFrame {
  t: number;
  jobs: JobRow[];
  workers: WorkerView[];
  writes: WriteEvent[];
  claims: { worker: string; job: string; token: number; reclaim: boolean }[];
  /** per worker, per tick: job id worked on, 'pause', or null */
  timeline: Record<string, (string | null)[]>;
}

interface JobDef {
  id: string;
  work: number;
  /** attempt numbers that fail with a transient error */
  failOn: number[];
}

export const JOBS: JobDef[] = [
  { id: 'J1', work: 3, failOn: [] },
  { id: 'J2', work: 2, failOn: [] },
  { id: 'J3', work: 2, failOn: [1] },
];

export const T_MAX = 12;

export function simulate({ lease, fencing }: Params): Frame[] {
  const jobs: JobRow[] = JOBS.map((d) => ({ id: d.id, status: 'PENDING', owner: null, token: 0, leaseUntil: null, attempts: 0, nextRunAt: 0, writes: [], work: d.work }));
  const workers = ['W1', 'W2'].map((id) => ({ id, job: null as string | null, token: 0, remaining: 0 }));
  const timeline: Record<string, (string | null)[]> = { W1: [], W2: [] };
  const frames: Frame[] = [];
  const def = (id: string) => JOBS.find((d) => d.id === id)!;
  const row = (id: string) => jobs.find((j) => j.id === id)!;
  const paused = (w: string, t: number) => w === 'W1' && t >= PAUSE_FROM && t <= PAUSE_TO;

  const snap = (t: number, caption: string, writes: WriteEvent[], claims: Frame['claims'], predict?: string) =>
    frames.push({
      caption,
      predict,
      t,
      jobs: jobs.map((j) => ({ ...j, writes: [...j.writes] })),
      workers: workers.map((w) => ({ ...w, paused: paused(w.id, t) })),
      writes,
      claims,
      timeline: { W1: [...timeline.W1], W2: [...timeline.W2] },
    });

  snap(
    -1,
    `Three jobs are due in the job table. Two workers poll it with SELECT … FOR UPDATE SKIP LOCKED, take a ${lease}-tick lease and heartbeat while they run. Fencing tokens are ${fencing ? 'ON: every claim bumps the token and the final write must carry it' : 'OFF: the final write is an unconditional UPDATE'}.`,
    [],
    [],
  );

  let zombieWarned = false;
  for (let t = 0; t <= T_MAX; t++) {
    const msgs: string[] = [];
    const writes: WriteEvent[] = [];
    const claims: Frame['claims'] = [];
    let predict: string | undefined;

    // 1. running workers: work, heartbeat, finish
    for (const w of workers) {
      if (!w.job) {
        timeline[w.id][t] = null;
        continue;
      }
      if (paused(w.id, t)) {
        timeline[w.id][t] = 'pause';
        if (t === PAUSE_FROM) msgs.push(`${w.id} freezes in a stop-the-world GC pause while holding ${w.job}: no work, no heartbeats.`);
        continue;
      }
      const j = row(w.job);
      timeline[w.id][t] = w.job;
      w.remaining--;
      if (w.remaining > 0) {
        if (j.token === w.token) {
          j.leaseUntil = t + lease;
        }
        continue;
      }
      // finished: transient failure or result write
      const attempt = j.attempts;
      const fails = def(j.id).failOn.includes(attempt) && j.token === w.token;
      if (fails) {
        const delay = BACKOFF_BASE * 2 ** (attempt - 1);
        j.status = 'RETRY';
        j.owner = null;
        j.leaseUntil = null;
        j.nextRunAt = t + delay;
        msgs.push(`${w.id} hits a transient error (a 503 from a downstream API) on ${j.id} attempt ${attempt}. The row goes to RETRY with next_run_at = ${t} + ${BACKOFF_BASE}×2^${attempt - 1} = ${j.nextRunAt}.`);
      } else {
        const accepted = !fencing || j.token === w.token;
        writes.push({ worker: w.id, job: j.id, token: w.token, accepted });
        if (accepted) {
          const stale = j.token !== w.token;
          j.writes.push(`${w.id}#${w.token}`);
          if (j.status !== 'SUCCEEDED' || stale) {
            j.status = 'SUCCEEDED';
          }
          if (j.token === w.token) {
            j.owner = null;
            j.leaseUntil = null;
          }
          msgs.push(
            stale
              ? `${w.id} wakes up and finishes ${j.id} with token ${w.token}, but the row now belongs to token ${j.token}. Without fencing its UPDATE succeeds anyway: a zombie has written ${j.id}'s result while another worker is still running it.`
              : j.writes.length > 1
                ? `${w.id} finishes ${j.id} and writes its result too: ${j.id} has now been executed and recorded ${j.writes.length} times (last writer wins).`
                : `${w.id} finishes ${j.id} and writes SUCCEEDED with token ${w.token}.`,
          );
        } else {
          msgs.push(`${w.id} wakes up and tries to write ${j.id}'s result with token ${w.token}. The row's token is ${j.token}, so UPDATE … WHERE token = ${w.token} matches 0 rows: the zombie's write is fenced off and it abandons the job.`);
        }
      }
      w.job = null;
      w.remaining = 0;
    }

    // 2. free workers claim due jobs (SKIP LOCKED: two claimers never get the same row)
    for (const w of workers) {
      if (w.job || paused(w.id, t)) continue;
      const due = jobs.find(
        (j) =>
          (j.status === 'PENDING' && j.nextRunAt <= t) ||
          (j.status === 'RETRY' && j.nextRunAt <= t) ||
          (j.status === 'RUNNING' && j.leaseUntil !== null && j.leaseUntil < t),
      );
      if (!due) continue;
      const reclaim = due.status === 'RUNNING';
      const prevOwner = due.owner;
      const oldLease = due.leaseUntil;
      due.status = 'RUNNING';
      due.owner = w.id;
      due.token++;
      due.attempts++;
      due.leaseUntil = t + lease;
      w.job = due.id;
      w.token = due.token;
      w.remaining = due.work;
      claims.push({ worker: w.id, job: due.id, token: due.token, reclaim });
      if (reclaim) {
        msgs.push(`${due.id}'s lease expired (lease_until ${oldLease} < now ${t}) while ${prevOwner} was silent, so ${w.id} reclaims it: token ${due.token}, attempt ${due.attempts}. ${prevOwner} does not know yet.`);
        if (!zombieWarned) {
          predict = `${prevOwner} is not dead, only paused. What happens when it wakes up holding token ${due.token - 1}?`;
          zombieWarned = true;
        }
      } else {
        msgs.push(`${w.id} claims ${due.id}${due.attempts > 1 ? ` (attempt ${due.attempts})` : ''}: token ${due.token}, lease_until ${due.leaseUntil}.`);
      }
    }

    const done = jobs.every((j) => j.status === 'SUCCEEDED') && workers.every((w) => !w.job);
    if (msgs.length === 0) {
      const holder = workers.find((w) => w.job && paused(w.id, t));
      if (holder) {
        const j = row(holder.job!);
        msgs.push(
          j.token !== holder.token
            ? `${holder.id} is still frozen and still believes it owns ${j.id}, which now belongs to ${j.owner} with token ${j.token}.`
            : `${holder.id} is still frozen. ${j.id}'s lease_until is ${j.leaseUntil}, so nobody may take it yet.`,
        );
      } else msgs.push('Workers keep running and heartbeating, which pushes lease_until forward.');
      const waiting = jobs.filter((j) => (j.status === 'RETRY' || j.status === 'PENDING') && j.nextRunAt <= t).map((j) => j.id);
      if (waiting.length) msgs.push(`${waiting.join(', ')} is due but every worker is busy, so it waits in the table.`);
    }
    snap(t, `t=${t}: ${msgs.join(' ')}`, writes, claims, predict);
    if (done) break;
  }

  const dup = jobs.filter((j) => j.writes.length > 1);
  const ran = jobs.map((j) => j.attempts).reduce((a, b) => a + b, 0);
  snap(
    frames[frames.length - 1].t,
    dup.length
      ? `Result: ${dup.map((j) => j.id).join(', ')} was completed twice and its stored result was overwritten by a stale worker. Leases alone cannot stop a paused process; a fencing token on every write can.`
      : zombieWarned
        ? `Result: all jobs succeeded and the zombie's late write was rejected. ${JOBS[0].id}'s handler still ran twice (${ran} executions for ${JOBS.length} jobs), which is why handlers must be idempotent: execution is at-least-once.`
        : `Result: the ${lease}-tick lease outlived W1's pause, so nothing was reclaimed. A longer lease avoids false takeovers but means a truly crashed worker's job sits idle until the lease expires.`,
    [],
    [],
  );
  return frames;
}
