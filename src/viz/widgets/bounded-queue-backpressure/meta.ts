import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'bounded-queue-backpressure',
  title: 'Producer–consumer: what a full queue does to a burst',
  blurb:
    'A producer bursts faster than the consumer loops drain. Pick the full-queue policy (unbounded, block, reject with 429, drop oldest), tune capacity, rate and consumers, and watch depth, memory, blocked time and lost items.',
  placements: [{ topic: 'lld-patterns-concurrency', heading: 'Producer–consumer with a bounded queue' }],
};
