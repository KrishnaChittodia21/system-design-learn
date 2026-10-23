// CI/CD runner dispatch: per-org queues, a dispatcher choosing by global FIFO or by weighted fair
// share (lowest running ÷ weight) under a concurrency cap, single-use runners that start at once
// from a warm pool or cold-boot otherwise, and leases that decide what happens when a runner dies.
import type { FlowEdge, FlowFrame, Tone } from './types';

export type Dispatch = 'fifo' | 'fair';

export interface CiParams {
  dispatch: Dispatch;
  warm: number;
  slots: number;
  die: boolean;
}

export const TICK_S = 15;
export const BOOT_TICKS = 3;
export const LEASE_TICKS = 2;

export interface OrgDef {
  id: string;
  weight: number;
  jobs: number;
  dur: number;
}

export const ORGS: OrgDef[] = [
  { id: 'A', weight: 1, jobs: 6, dur: 3 },
  { id: 'B', weight: 1, jobs: 2, dur: 2 },
  { id: 'C', weight: 2, jobs: 3, dur: 2 },
];

export interface Job {
  id: string;
  org: string;
  dur: number;
  /** queue order (A pushed first) */
  seq: number;
}

export interface Slot {
  job: Job;
  phase: 'booting' | 'running' | 'lost';
  left: number;
  started: boolean;
  warm: boolean;
}

export interface Done {
  job: Job;
  /** seconds from enqueue to first step */
  wait: number;
  status: 'ok' | 'failed' | 'requeued';
}

export interface CiFrame extends FlowFrame {
  t: number;
  queues: Record<string, string[]>;
  slots: Slot[];
  warmReady: number;
  refills: number[];
  done: Done[];
  assigned: string[];
}

export function initialJobs(): Job[] {
  const jobs: Job[] = [];
  let seq = 0;
  for (const o of ORGS) for (let i = 1; i <= o.jobs; i++) jobs.push({ id: `${o.id}${i}`, org: o.id, dur: o.dur, seq: seq++ });
  return jobs;
}

/** Pick the next job: global FIFO, or the org with the lowest running ÷ weight (then its oldest job). */
export function pickNext(queue: Job[], running: Record<string, number>, dispatch: Dispatch): Job | undefined {
  if (!queue.length) return undefined;
  if (dispatch === 'fifo') return [...queue].sort((a, b) => a.seq - b.seq)[0];
  const orgs = ORGS.filter((o) => queue.some((j) => j.org === o.id));
  orgs.sort((a, b) => (running[a.id] ?? 0) / a.weight - (running[b.id] ?? 0) / b.weight || ORGS.indexOf(a) - ORGS.indexOf(b));
  return queue.filter((j) => j.org === orgs[0].id).sort((a, b) => a.seq - b.seq)[0];
}

export function simulateCi({ dispatch, warm, slots: cap, die }: CiParams): CiFrame[] {
  const frames: CiFrame[] = [];
  let queue = initialJobs();
  const slots: Slot[] = [];
  let warmReady = warm;
  let refills: number[] = []; // ticks left until a replacement warm VM is ready
  const done: Done[] = [];
  let t = 0;
  let deathAt = -1;
  let deathSlot: Slot | null = null;
  const snap = (active: Record<string, Tone>, edges: FlowEdge[], caption: string, assigned: string[] = [], predict?: string) =>
    frames.push({
      active,
      edges,
      caption,
      predict,
      t,
      queues: Object.fromEntries(ORGS.map((o) => [o.id, queue.filter((j) => j.org === o.id).map((j) => j.id)])),
      slots: slots.map((s) => ({ ...s })),
      warmReady,
      refills: [...refills],
      done: done.map((d) => ({ ...d })),
      assigned,
    });

  snap(
    {},
    [],
    `Org A pushes first and queues 6 jobs, then B queues 2 and C (a bigger plan, weight 2) queues 3. The pool runs at most ${cap} jobs at once; ${warm} booted, never-used VM${warm === 1 ? ' is' : 's are'} waiting in the warm pool. A cold VM takes ${BOOT_TICKS * TICK_S} s to boot. One tick = ${TICK_S} s.`,
  );

  const runningByOrg = () => {
    const r: Record<string, number> = {};
    for (const s of slots) r[s.job.org] = (r[s.job.org] ?? 0) + 1;
    return r;
  };

  let guard = 0;
  while ((queue.length || slots.length) && guard++ < 60) {
    // 1. dispatch into free capacity
    const assigned: string[] = [];
    while (slots.length < cap && queue.length) {
      const j = pickNext(queue, runningByOrg(), dispatch)!;
      queue = queue.filter((x) => x !== j);
      if (warmReady > 0) {
        warmReady--;
        refills.push(BOOT_TICKS);
        slots.push({ job: j, phase: 'running', left: j.dur, started: true, warm: true });
        done.push({ job: j, wait: t * TICK_S, status: 'ok' });
      } else slots.push({ job: j, phase: 'booting', left: BOOT_TICKS, started: false, warm: false });
      assigned.push(j.id);
    }
    // a runner dies (once)
    let deathNote = '';
    if (die && deathAt < 0 && t === 2 && slots.length) {
      deathSlot = slots[0];
      deathAt = t;
      deathSlot.phase = 'lost';
      deathNote = ` Runner for ${deathSlot.job.id} stops heartbeating (host died); its lease expires in ${LEASE_TICKS * TICK_S} s.`;
    }
    const r = runningByOrg();
    const shares = ORGS.map((o) => `${o.id} ${r[o.id] ?? 0}/${o.weight}`).join(', ');
    const what = assigned.length
      ? `t=${t * TICK_S}s: dispatcher assigns ${assigned.join(', ')}${dispatch === 'fair' ? ` (running ÷ weight now ${shares})` : ' in arrival order'}.`
      : `t=${t * TICK_S}s: no free capacity; ${queue.length} job${queue.length === 1 ? '' : 's'} waiting.`;
    const bootNote = slots.some((s) => s.phase === 'booting') ? ` ${slots.filter((s) => s.phase === 'booting').map((s) => s.job.id).join(', ')} cold-booting.` : '';
    snap(
      { queues: 'accent', dispatcher: assigned.length ? 'accent' : 'muted', pool: 'accent', ...(deathNote ? { pool: 'bad' as Tone } : {}) },
      assigned.length ? [{ from: 'queues', to: 'dispatcher', tone: 'accent' }, { from: 'dispatcher', to: 'pool', label: assigned.join(' '), tone: 'accent' }] : [],
      what + bootNote + deathNote,
      assigned,
      t === 0 && dispatch === 'fifo' ? 'With a single FIFO, when does org B\'s first job start?' : t === 0 ? 'Org C has weight 2. How many of its jobs run alongside A\'s?' : undefined,
    );

    // 2. advance one tick
    t++;
    refills = refills.map((x) => x - 1);
    warmReady += refills.filter((x) => x <= 0).length;
    refills = refills.filter((x) => x > 0);
    for (const s of [...slots]) {
      if (s.phase === 'lost') {
        if (deathAt >= 0 && t - deathAt >= LEASE_TICKS) {
          slots.splice(slots.indexOf(s), 1);
          if (s.started) {
            const d = done.find((x) => x.job === s.job);
            if (d) d.status = 'failed';
          } else {
            queue.push(s.job); // same attempt, back to the front of its org by seq
            done.push({ job: s.job, wait: -1, status: 'requeued' });
          }
        }
        continue;
      }
      s.left--;
      if (s.left <= 0) {
        if (s.phase === 'booting') {
          s.phase = 'running';
          s.started = true;
          s.left = s.job.dur;
          done.push({ job: s.job, wait: t * TICK_S, status: 'ok' });
        } else slots.splice(slots.indexOf(s), 1); // job done; VM destroyed
      }
    }
    // a requeued job that never started is shown once, then removed from the done list when it starts again
    for (const d of [...done]) if (d.status === 'requeued' && done.some((x) => x !== d && x.job === d.job && x.status === 'ok')) done.splice(done.indexOf(d), 1);
  }

  const avg = (org: string) => {
    const ws = done.filter((d) => d.job.org === org && d.wait >= 0).map((d) => d.wait);
    return ws.length ? Math.round(ws.reduce((a, b) => a + b, 0) / ws.length) : 0;
  };
  const failed = done.filter((d) => d.status === 'failed').map((d) => d.job.id);
  snap(
    { dispatcher: 'good' },
    [],
    `All done at t=${t * TICK_S}s. Average wait before the first step: A ${avg('A')} s, B ${avg('B')} s, C ${avg('C')} s.${
      dispatch === 'fifo' ? ' One global FIFO made B and C wait behind A\'s whole push.' : ' Fair share interleaved the orgs, so a big push from A cannot starve B and C.'
    }${failed.length ? ` ${failed.join(', ')} had started when its runner died, so it was marked failed ("runner lost communication") instead of silently re-run: a step may have half-deployed something.` : ''}${
      warm === 0 ? ' Every job paid the cold boot.' : ''
    }`,
  );
  return frames;
}
