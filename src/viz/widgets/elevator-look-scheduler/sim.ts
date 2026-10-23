// Pure simulation of one elevator car serving hall calls (floor + direction) and cab calls
// (floor) under four scheduling policies. LOOK is a direct port of the topic's LookScheduler,
// so the textbook run (car idle at 3; cab 7, 5▼, 4▲, 1▲, 9▼) stops at 4, 7, 9, 5, 1.
// One tick = move one floor OR dwell at a floor with the doors open. No React here.
import type { BaseFrame } from '../../core';

export type Algo = 'look' | 'scan' | 'sstf' | 'fcfs';
export type Scenario = 'textbook' | 'stream';
export type Dir = 'UP' | 'DOWN' | 'IDLE';

export interface Params {
  algo: Algo;
  scenario: Scenario;
}

export const TOP = 11; // floors 0..11

export interface Req {
  id: number;
  kind: 'CAB' | 'UP' | 'DOWN';
  floor: number;
  at: number;
}

export interface ReqState extends Req {
  servedAt: number | null;
}

export interface Frame extends BaseFrame {
  tick: number;
  floor: number;
  dir: Dir;
  doorsOpen: boolean;
  /** every position so far, index = tick */
  path: number[];
  /** stops so far: tick + floor */
  stops: { t: number; floor: number }[];
  reqs: ReqState[];
  travelled: number;
  done: boolean;
}

export const ALGO_NAME: Record<Algo, string> = {
  look: 'LOOK',
  scan: 'SCAN',
  sstf: 'SSTF (nearest first)',
  fcfs: 'FCFS',
};

export function scenarioRequests(s: Scenario): { start: number; reqs: Req[] } {
  if (s === 'textbook')
    return {
      start: 3,
      reqs: [
        { id: 1, kind: 'CAB', floor: 7, at: 0 },
        { id: 2, kind: 'DOWN', floor: 5, at: 0 },
        { id: 3, kind: 'UP', floor: 4, at: 0 },
        { id: 4, kind: 'UP', floor: 1, at: 0 },
        { id: 5, kind: 'DOWN', floor: 9, at: 0 },
      ],
    };
  // a far call at floor 11, then a steady trickle of calls near the car's floor
  return {
    start: 4,
    reqs: [
      { id: 1, kind: 'DOWN', floor: 11, at: 0 },
      { id: 2, kind: 'UP', floor: 3, at: 0 },
      { id: 3, kind: 'DOWN', floor: 5, at: 2 },
      { id: 4, kind: 'UP', floor: 3, at: 5 },
      { id: 5, kind: 'CAB', floor: 6, at: 7 },
      { id: 6, kind: 'DOWN', floor: 4, at: 10 },
      { id: 7, kind: 'UP', floor: 2, at: 12 },
      { id: 8, kind: 'CAB', floor: 5, at: 14 },
      { id: 9, kind: 'DOWN', floor: 3, at: 17 },
    ],
  };
}

const arrow = (r: Req) => (r.kind === 'CAB' ? `cab ${r.floor}` : `${r.floor}${r.kind === 'UP' ? '▲' : '▼'}`);
export const reqLabel = arrow;

// ---------------------------------------------------------------------------------------
// LOOK: the topic's LookScheduler, over the set of currently known, unserved requests.
// ---------------------------------------------------------------------------------------
function anyBeyond(pending: ReqState[], f: number, dir: 'UP' | 'DOWN') {
  return pending.some((r) => (dir === 'UP' ? r.floor > f : r.floor < f));
}
function lookShouldStop(pending: ReqState[], floor: number, dir: Dir): boolean {
  const here = pending.filter((r) => r.floor === floor);
  if (dir === 'IDLE') return here.length > 0;
  if (here.some((r) => r.kind === 'CAB' || r.kind === dir)) return true;
  return !anyBeyond(pending, floor, dir) && here.length > 0; // LOOK turnaround
}
/** which requests at this floor a stop serves */
function lookServes(pending: ReqState[], floor: number, dir: Dir): ReqState[] {
  const here = pending.filter((r) => r.floor === floor);
  if (dir === 'IDLE') return here;
  const turnaround = !anyBeyond(pending, floor, dir);
  return here.filter((r) => r.kind === 'CAB' || r.kind === dir || turnaround);
}
function nearest(pending: ReqState[], cur: number): number {
  return pending.reduce((a, b) => (Math.abs(b.floor - cur) < Math.abs(a.floor - cur) ? b : a)).floor;
}
function lookNextDir(pending: ReqState[], cur: number, dir: Dir): Dir {
  if (!pending.length) return 'IDLE';
  if (dir !== 'IDLE' && anyBeyond(pending, cur, dir)) return dir;
  if (dir === 'UP' && anyBeyond(pending, cur, 'DOWN')) return 'DOWN';
  if (dir === 'DOWN' && anyBeyond(pending, cur, 'UP')) return 'UP';
  const n = nearest(pending, cur);
  return n > cur ? 'UP' : n < cur ? 'DOWN' : 'IDLE';
}

// ---------------------------------------------------------------------------------------
// SCAN: sweep to the physical end of the shaft before reversing.
// ---------------------------------------------------------------------------------------
function scanServes(pending: ReqState[], floor: number, dir: Dir): ReqState[] {
  const here = pending.filter((r) => r.floor === floor);
  if (dir === 'IDLE' || floor === 0 || floor === TOP) return here;
  return here.filter((r) => r.kind === 'CAB' || r.kind === dir);
}
function scanNextDir(pending: ReqState[], cur: number, dir: Dir): Dir {
  if (!pending.length) return 'IDLE';
  if (dir === 'UP') return cur < TOP ? 'UP' : 'DOWN';
  if (dir === 'DOWN') return cur > 0 ? 'DOWN' : 'UP';
  const n = nearest(pending, cur);
  return n > cur ? 'UP' : n < cur ? 'DOWN' : 'IDLE';
}

// ---------------------------------------------------------------------------------------
// SSTF and FCFS: pick one target floor; serve everything waiting at that floor on arrival.
// ---------------------------------------------------------------------------------------
function targetFloor(algo: 'sstf' | 'fcfs', pending: ReqState[], cur: number): number | null {
  if (!pending.length) return null;
  if (algo === 'fcfs') return [...pending].sort((a, b) => a.at - b.at || a.id - b.id)[0].floor;
  return nearest(pending, cur);
}

export function simulate(p: Params): Frame[] {
  const { start, reqs } = scenarioRequests(p.scenario);
  const all: ReqState[] = reqs.map((r) => ({ ...r, servedAt: null }));
  const frames: Frame[] = [];
  let floor = start;
  let dir: Dir = 'IDLE';
  let travelled = 0;
  const path: number[] = [floor];
  const stops: { t: number; floor: number }[] = [];
  const known = (t: number) => all.filter((r) => r.at <= t && r.servedAt === null);
  const lastArrival = Math.max(...reqs.map((r) => r.at));

  const snap = (tick: number, caption: string, doorsOpen: boolean, done = false, predict?: string) =>
    frames.push({
      tick,
      floor,
      dir,
      doorsOpen,
      path: [...path],
      stops: stops.map((s) => ({ ...s })),
      reqs: all.map((r) => ({ ...r })),
      travelled,
      done,
      caption,
      predict,
    });

  const intro =
    p.scenario === 'textbook'
      ? `Car idle at floor ${start}. Requests: ${reqs.map(arrow).join(', ')}. ${ALGO_NAME[p.algo]} decides the order.`
      : `Car idle at floor ${start}. Someone at floor 11 wants to go down, and calls near floor 4 keep arriving. Watch how long 11▼ waits under ${ALGO_NAME[p.algo]}.`;
  snap(0, intro, false, false, p.algo === 'look' && p.scenario === 'textbook' ? 'Which floor does LOOK stop at first: 4 or 5? And where does it turn around?' : undefined);

  for (let t = 0; t < 80; t++) {
    const pending = known(t);
    if (!pending.length && t >= lastArrival) break;
    let serve: ReqState[] = [];
    if (p.algo === 'look') {
      if (lookShouldStop(pending, floor, dir)) serve = lookServes(pending, floor, dir);
    } else if (p.algo === 'scan') {
      serve = scanServes(pending, floor, dir);
    } else {
      const tgt = targetFloor(p.algo, pending, floor);
      if (tgt === floor) serve = pending.filter((r) => r.floor === floor);
    }

    if (serve.length) {
      const turnaround =
        p.algo === 'look' && dir !== 'IDLE' && !anyBeyond(pending, floor, dir) && serve.some((r) => r.kind !== 'CAB' && r.kind !== dir);
      for (const r of serve) r.servedAt = t;
      stops.push({ t, floor });
      path.push(floor);
      const after = known(t);
      dir = p.algo === 'look' ? lookNextDir(after, floor, dir) : p.algo === 'scan' ? scanNextDir(after, floor, dir) : 'IDLE';
      const waits = serve.map((r) => `${arrow(r)} waited ${t - r.at}`).join(', ');
      const turn = turnaround ? ' Nothing further this way, so this is the LOOK turnaround: the opposite-direction call is served here.' : '';
      snap(t + 1, `t=${t + 1}: doors open at floor ${floor}, serving ${waits}.${turn}`, true);
      continue;
    }

    // decide direction and move one floor
    if (p.algo === 'look') dir = lookNextDir(pending, floor, dir);
    else if (p.algo === 'scan') dir = scanNextDir(pending, floor, dir);
    else {
      const tgt = targetFloor(p.algo, pending, floor);
      dir = tgt === null ? 'IDLE' : tgt > floor ? 'UP' : tgt < floor ? 'DOWN' : 'IDLE';
    }
    if (dir === 'IDLE') {
      path.push(floor);
      snap(t + 1, `t=${t + 1}: nothing to do; car waits at floor ${floor}.`, false);
      continue;
    }
    const from = floor;
    floor += dir === 'UP' ? 1 : -1;
    travelled++;
    path.push(floor);
    let why = '';
    if (p.algo === 'look') {
      const passed = pending.filter((r) => r.floor === floor && r.kind !== 'CAB' && r.kind !== dir);
      if (passed.length && anyBeyond(pending, floor, dir)) why = ` Passes ${passed.map(arrow).join(', ')}: it wants the other direction and there are still calls ahead.`;
    } else if (p.algo === 'scan' && (floor === TOP || floor === 0) && !pending.some((r) => r.floor === floor))
      why = ' SCAN runs to the end of the shaft even though nobody called it here: wasted travel.';
    else if (p.algo === 'sstf' || p.algo === 'fcfs') {
      const tgt = targetFloor(p.algo, pending, from);
      why = ` Heading for floor ${tgt} (${p.algo === 'fcfs' ? 'oldest request' : 'closest request'}).`;
    }
    const arrivals = all.filter((r) => r.at === t + 1);
    const arr = arrivals.length ? ` New call: ${arrivals.map(arrow).join(', ')}.` : '';
    snap(t + 1, `t=${t + 1}: moving ${dir === 'UP' ? 'up' : 'down'} to floor ${floor}.${why}${arr}`, false);
  }

  const served = all.filter((r) => r.servedAt !== null);
  const waits = served.map((r) => (r.servedAt as number) - r.at);
  const maxWait = Math.max(...waits);
  const worst = served.find((r) => (r.servedAt as number) - r.at === maxWait)!;
  const avg = waits.reduce((a, b) => a + b, 0) / waits.length;
  const order = stops.map((s) => s.floor).join(' → ');
  const lesson: Record<Algo, string> = {
    look: 'LOOK reverses at the last request, so it never wastes travel and every call is reached within one sweep.',
    scan: 'SCAN is fair but travels to the physical end of the shaft before turning, which costs extra floors.',
    sstf: 'SSTF minimises each hop but far floors can starve while nearby calls keep arriving.',
    fcfs: 'FCFS zig-zags across the building in arrival order, so total travel balloons.',
  };
  snap(
    frames[frames.length - 1].tick,
    `Done. Stops: ${order}. ${travelled} floors travelled, average wait ${avg.toFixed(1)} ticks, worst ${maxWait} (${arrow(worst)}). ${lesson[p.algo]}`,
    false,
    true,
  );
  return frames;
}

/** summary used by the widget's comparison strip and by tests */
export function summarise(p: Params) {
  const frames = simulate(p);
  const last = frames[frames.length - 1];
  const waits = last.reqs.map((r) => (r.servedAt ?? NaN) - r.at);
  return {
    order: last.stops.map((s) => s.floor),
    travelled: last.travelled,
    maxWait: Math.max(...waits),
    avgWait: waits.reduce((a, b) => a + b, 0) / waits.length,
    allServed: last.reqs.every((r) => r.servedAt !== null),
  };
}
