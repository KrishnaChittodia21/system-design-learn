// Pure, deterministic simulation of an application connection pool under an incident.
// One tick = 100 ms. Requests arrive at a fixed rate, wait FIFO for a connection, hold it for the
// query's duration, then release it. Little's Law: connections needed = arrival rate × hold time.
import type { BaseFrame } from '../../core';

export type Incident = 'slow' | 'burst';
export type AcquireTimeout = 'none' | 'fast';

export interface Params {
  pool: number;
  incident: Incident;
  acquire: AcquireTimeout;
}

export const TICK_MS = 100;
export const TICKS = 30;
export const BASE_RATE = 3; // requests per tick (30 req/s)
export const BASE_HOLD = 2; // ticks a request holds its connection (200 ms)
export const INCIDENT_FROM = 3;
export const INCIDENT_TO = 14; // exclusive
export const SLOW_HOLD = 8; // 800 ms per query while the DB is slow
export const BURST_RATE = 9; // 90 req/s during the spike
export const ACQUIRE_TIMEOUT = 3; // ticks (300 ms) when fail-fast is on
export const GATEWAY_TIMEOUT = 10; // ticks (1 s): the client gives up

export const INCIDENT_LABELS: Record<Incident, string> = {
  slow: 'queries get 4× slower',
  burst: 'traffic triples',
};
export const ACQUIRE_LABELS: Record<AcquireTimeout, string> = {
  none: 'wait forever',
  fast: `fail fast at ${ACQUIRE_TIMEOUT * TICK_MS}ms`,
};


export interface Slot {
  /** request id holding the connection, or null when idle */
  req: number | null;
  /** ticks of work left */
  left: number;
  hold: number;
  /** the client already gave up (gateway timeout): the DB is working for nobody */
  zombie: boolean;
}

export interface Waiter {
  id: number;
  arrived: number;
}

export interface Tick {
  t: number;
  inUse: number;
  queue: number;
  arrivals: number;
  /** Little's Law demand: arrival rate × hold time */
  demand: number;
}

export interface Frame extends BaseFrame {
  t: number;
  slots: Slot[];
  queue: Waiter[];
  history: Tick[];
  rate: number;
  hold: number;
  ok: number;
  failFast: number;
  gateway: number;
  wasted: number;
  /** mean acquire wait (ms) of requests that got a connection this run */
  avgWaitMs: number;
  maxQueue: number;
  /** what happened to requests in this tick, for the caption/highlight */
  events: { acquired: number; released: number; failed: number; expired: number };
}

export const rateAt = (t: number, incident: Incident): number => (incident === 'burst' && t >= INCIDENT_FROM && t < INCIDENT_TO ? BURST_RATE : BASE_RATE);
export const holdAt = (t: number, incident: Incident): number => (incident === 'slow' && t >= INCIDENT_FROM && t < INCIDENT_TO ? SLOW_HOLD : BASE_HOLD);

export function simulate({ pool, incident, acquire }: Params): Frame[] {
  const slots: Slot[] = Array.from({ length: pool }, () => ({ req: null, left: 0, hold: 0, zombie: false }));
  let queue: Waiter[] = [];
  const history: Tick[] = [];
  const arrivedAt = new Map<number, number>();
  let nextId = 1;
  let ok = 0;
  let failFast = 0;
  let gateway = 0;
  let wasted = 0;
  let waitSum = 0;
  let waitCount = 0;
  let maxQueue = 0;
  const frames: Frame[] = [];

  const snap = (t: number, caption: string, events: Frame['events']): Frame => ({
    t,
    slots: slots.map((s) => ({ ...s })),
    queue: queue.map((w) => ({ ...w })),
    history: history.map((h) => ({ ...h })),
    rate: rateAt(Math.max(0, t), incident),
    hold: holdAt(Math.max(0, t), incident),
    ok,
    failFast,
    gateway,
    wasted,
    avgWaitMs: waitCount ? Math.round((waitSum / waitCount) * TICK_MS) : 0,
    maxQueue,
    events,
    caption,
  });

  frames.push(
    snap(
      -1,
      `Pool of ${pool} connections. Normal load: ${BASE_RATE * 10} req/s, each request holds a connection for ${BASE_HOLD * TICK_MS} ms, so Little's Law says ${BASE_RATE * 10} × ${BASE_HOLD * TICK_MS / 1000} s = ${BASE_RATE * BASE_HOLD} connections busy on average. At t=${INCIDENT_FROM * TICK_MS} ms ${INCIDENT_LABELS[incident]}. Acquire timeout: ${ACQUIRE_LABELS[acquire]}; the gateway gives up after ${GATEWAY_TIMEOUT * TICK_MS} ms.`,
      { acquired: 0, released: 0, failed: 0, expired: 0 },
    ),
  );

  for (let t = 0; t < TICKS; t++) {
    const rate = rateAt(t, incident);
    const hold = holdAt(t, incident);
    let released = 0;
    let acquired = 0;
    let failed = 0;
    let expired = 0;

    // 1. finished queries release their connection
    for (const s of slots) {
      if (s.req === null) continue;
      s.left--;
      if (s.left <= 0) {
        const total = t - arrivedAt.get(s.req)!;
        if (s.zombie) wasted++;
        else if (total > GATEWAY_TIMEOUT) gateway++;
        else ok++;
        s.req = null;
        s.zombie = false;
        s.hold = 0;
        released++;
      }
    }

    // 2. arrivals join the FIFO wait queue
    for (let k = 0; k < rate; k++) {
      const id = nextId++;
      arrivedAt.set(id, t);
      queue.push({ id, arrived: t });
    }

    // 3. waiters time out: fail fast at the pool, or the client gives up at the gateway
    const keep: Waiter[] = [];
    for (const w of queue) {
      const waited = t - w.arrived;
      if (acquire === 'fast' && waited >= ACQUIRE_TIMEOUT) {
        failFast++;
        failed++;
      } else {
        if (acquire === 'none' && waited === GATEWAY_TIMEOUT) expired++;
        keep.push(w);
      }
    }
    queue = keep;

    // 4. idle connections go to the head of the queue
    for (const s of slots) {
      if (s.req !== null || !queue.length) continue;
      const w = queue.shift()!;
      const waited = t - w.arrived;
      s.req = w.id;
      s.left = hold;
      s.hold = hold;
      // with no acquire timeout, a request whose client already left still runs its query
      s.zombie = waited >= GATEWAY_TIMEOUT;
      waitSum += waited;
      waitCount++;
      acquired++;
    }
    // waiters still queued past the gateway timeout are counted as 504s when the run ends
    maxQueue = Math.max(maxQueue, queue.length);
    const inUse = slots.filter((s) => s.req !== null).length;
    history.push({ t, inUse, queue: queue.length, arrivals: rate, demand: rate * hold });

    const phase = t < INCIDENT_FROM ? 'normal' : t < INCIDENT_TO ? 'incident' : 'recovered';
    const demand = rate * hold;
    let caption = `t=${t * TICK_MS} ms (${phase}): ${rate} new requests, ${released} released, ${acquired} got a connection. In use ${inUse}/${pool}, ${queue.length} waiting. Demand λ×W = ${rate * 10}/s × ${hold * TICK_MS} ms = ${demand}`;
    const spare = pool / hold - rate;
    caption +=
      demand > pool
        ? ` > ${pool} connections, so the queue must grow.`
        : queue.length
          ? ` ≤ ${pool}: spare capacity is only ${pool}/${hold} − ${rate} = ${+spare.toFixed(1)} request${spare === 1 ? '' : 's'} per tick to drain the backlog.`
          : ` ≤ ${pool}, so the pool keeps up.`;
    if (failed) caption += ` ${failed} request${failed === 1 ? '' : 's'} waited ${ACQUIRE_TIMEOUT * TICK_MS} ms and failed fast with 503 + Retry-After.`;
    if (expired) caption += ` ${expired} queued request${expired === 1 ? '' : 's'} passed the 1 s gateway timeout: the user already saw a 504, but the request is still in line for a connection.`;
    const zombies = slots.filter((s) => s.zombie).length;
    if (zombies && acquire === 'none') caption += ` ${zombies} connection${zombies === 1 ? ' is' : 's are'} running queries for clients that have gone away.`;
    frames.push(snap(t, caption, { acquired, released, failed, expired }));
  }

  // anything still waiting at the end is past saving
  const snapWait = () => (waitCount ? Math.round((waitSum / waitCount) * TICK_MS) : 0);
  const last = frames[frames.length - 1];
  const stuck = queue.filter((w) => TICKS - 1 - w.arrived >= GATEWAY_TIMEOUT).length;
  const bad = gateway + stuck + wasted;
  const summary =
    acquire === 'none'
      ? `Summary: ${ok} succeeded, ${gateway + stuck} hit the gateway timeout${wasted ? `, ${wasted} queries ran for clients that had already gone` : ''}; peak queue ${maxQueue}, average wait ${snapWait()} ms. ${bad ? 'Waiting forever turns a slowdown into a backlog that outlives the incident.' : 'This pool absorbed the incident; shrink it or worsen the incident to see the backlog.'}`
      : `Summary: ${ok} succeeded, ${failFast} failed fast (503) and ${gateway} hit the gateway; peak queue ${maxQueue}, average wait ${snapWait()} ms. ${failFast ? 'Failing fast sheds the excess so the requests that do get a connection still finish in time.' : 'Nothing had to be shed.'}`;
  last.caption += ` ${summary}`;

  const firstIncident = frames.findIndex((f) => f.t === INCIDENT_FROM);
  if (firstIncident > 0)
    frames[firstIncident - 1].predict = `Next tick ${INCIDENT_LABELS[incident]}. Demand becomes ${rateAt(INCIDENT_FROM, incident) * 10}/s × ${holdAt(INCIDENT_FROM, incident) * TICK_MS} ms = ${rateAt(INCIDENT_FROM, incident) * holdAt(INCIDENT_FROM, incident)} connections against a pool of ${pool}. What happens to the queue?`;
  const recover = frames.findIndex((f) => f.t === INCIDENT_TO);
  if (recover > 0)
    frames[recover - 1].predict = `The incident ends next tick. Does the queue drain at once${acquire === 'none' ? ', and are the people in it still waiting?' : '?'}`;
  return frames;
}
