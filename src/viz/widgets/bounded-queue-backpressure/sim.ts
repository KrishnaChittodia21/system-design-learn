// Pure tick simulation of one in-process producer–consumer queue under a burst. Producers
// arrive faster than consumers drain; the full-queue policy decides what happens: grow without
// bound, block the producer (backpressure), reject with a 429, or drop the oldest item.
// No React here so the counts can be checked with Node.
import type { BaseFrame } from '../../core';

export type Policy = 'unbounded' | 'block' | 'reject' | 'drop-oldest';

export interface Params {
  policy: Policy;
  capacity: number;
  /** items the producer wants to enqueue per tick during the burst */
  rate: number;
  /** consumer loops; each finishes one item per tick */
  consumers: number;
}

export const DEFAULT_PARAMS: Params = { policy: 'unbounded', capacity: 6, rate: 3, consumers: 2 };
export const BURST_TICKS = 10;
export const TICKS = 48;
export const ITEM_KB = 4;

export interface Frame extends BaseFrame {
  tick: number;
  /** item ids in the queue, oldest first */
  queue: number[];
  /** ids being processed by each consumer this tick */
  working: (number | null)[];
  /** queue depth after each tick so far */
  depth: number[];
  produced: number;
  accepted: number;
  rejected: number;
  dropped: number;
  processed: number;
  /** items the producer still has to hand over (only grows while it is blocked) */
  backlog: number;
  blockedTicks: number;
  /** what happened to this tick's offers */
  events: { id: number; fate: 'queued' | 'rejected' | 'dropped-old' | 'waiting' }[];
}

export function simulate(p: Params): Frame[] {
  const frames: Frame[] = [];
  const queue: number[] = [];
  const depth: number[] = [];
  let nextId = 1;
  let produced = 0;
  let accepted = 0;
  let rejected = 0;
  let dropped = 0;
  let processed = 0;
  let blockedTicks = 0;
  /** blocked producer: ids generated but not yet handed over */
  const pending: number[] = [];
  const cap = p.policy === 'unbounded' ? Infinity : p.capacity;
  let working: (number | null)[] = Array.from({ length: p.consumers }, () => null);

  const snap = (tick: number, events: Frame['events'], caption: string, predict?: string) =>
    frames.push({
      tick,
      queue: [...queue],
      working: [...working],
      depth: [...depth],
      produced,
      accepted,
      rejected,
      dropped,
      processed,
      backlog: pending.length,
      blockedTicks,
      events,
      caption,
      predict,
    });

  const net = p.rate - p.consumers;
  snap(
    0,
    [],
    `Burst for ${BURST_TICKS} ticks: the producer wants ${p.rate} item(s)/tick, ${p.consumers} consumer loop(s) finish ${p.consumers}/tick. ${
      net > 0 ? `Net +${net}/tick must go somewhere.` : 'Consumers keep up, so the policy never matters.'
    } Policy: ${p.policy === 'unbounded' ? 'unbounded array' : `bounded (${p.capacity}), ${p.policy}`}.`,
    net > 0 && p.policy === 'unbounded' ? 'With nothing to stop it, how deep will the queue be when the burst ends?' : undefined,
  );

  for (let t = 1; t <= TICKS; t++) {
    // 1. consumers finish their item and take the next one (each frees one slot)
    processed += working.filter((w) => w !== null).length;
    working = working.map(() => queue.shift() ?? null);
    // 2. the producer offers this tick's items (blocked items first, in order)
    const events: Frame['events'] = [];
    const fresh: number[] = [];
    if (t <= BURST_TICKS) for (let k = 0; k < p.rate; k++) fresh.push(nextId++);
    produced += fresh.length;
    if (p.policy === 'block') {
      pending.push(...fresh);
      while (pending.length && queue.length < cap) {
        const id = pending.shift()!;
        queue.push(id);
        accepted++;
        events.push({ id, fate: 'queued' });
      }
      for (const id of pending) events.push({ id, fate: 'waiting' });
      if (pending.length) blockedTicks++;
    } else {
      for (const id of fresh) {
        if (queue.length < cap) {
          queue.push(id);
          accepted++;
          events.push({ id, fate: 'queued' });
        } else if (p.policy === 'reject') {
          rejected++;
          events.push({ id, fate: 'rejected' });
        } else {
          const old = queue.shift()!;
          dropped++;
          events.push({ id: old, fate: 'dropped-old' });
          queue.push(id);
          accepted++;
          events.push({ id, fate: 'queued' });
        }
      }
    }
    depth.push(queue.length);

    const parts: string[] = [];
    const q = events.filter((e) => e.fate === 'queued').length;
    if (fresh.length || pending.length) parts.push(`${q} enqueued`);
    const r = events.filter((e) => e.fate === 'rejected').length;
    if (r) parts.push(`${r} rejected with 429 (offer() returned false)`);
    const d = events.filter((e) => e.fate === 'dropped-old').length;
    if (d) parts.push(`${d} oldest dropped to make room`);
    if (pending.length) parts.push(`producer blocked: put() is waiting with ${pending.length} item(s) in hand`);
    const head = t === BURST_TICKS + 1 ? 'Burst over. ' : '';
    const mem =
      p.policy === 'unbounded' && queue.length > p.capacity ? ` ≈${queue.length * ITEM_KB} KB of heap and growing with the burst.` : '';
    snap(
      t,
      events,
      `t=${t}: ${head}consumers took ${working.filter((w) => w !== null).length}; ${parts.join('; ') || 'no new items'}. Depth ${queue.length}${
        cap === Infinity ? '' : `/${cap}`
      }.${mem}`,
      t === BURST_TICKS && p.policy === 'block' && pending.length
        ? 'The burst ends next tick. Was any item lost under the block policy?'
        : undefined,
    );
    if (t > BURST_TICKS && !queue.length && !pending.length && working.every((w) => w === null)) break;
  }

  const maxDepth = Math.max(0, ...depth);
  const lesson: Record<Policy, string> = {
    unbounded: `Peak depth ${maxDepth} (≈${maxDepth * ITEM_KB} KB). At 500 items/s that is the topic’s OOM-kill, and every queued item dies with the pod.`,
    block: `Nothing lost and depth never exceeded ${p.capacity}: the producer was slowed to consumer speed for ${blockedTicks} tick(s). Right for a loop you control.`,
    reject: `${rejected} request(s) got an immediate 429 and depth stayed ≤ ${p.capacity}. Right for user-facing producers: failing fast beats timing out.`,
    'drop-oldest': `${dropped} stale item(s) dropped and depth stayed ≤ ${p.capacity}. Right only when newer data supersedes older (telemetry, location pings).`,
  };
  snap(
    frames[frames.length - 1].tick,
    [],
    `Done: produced ${produced}, processed ${processed}${rejected ? `, rejected ${rejected}` : ''}${dropped ? `, dropped ${dropped}` : ''}. ${lesson[p.policy]}`,
  );
  return frames;
}
