import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'db-pool-exhaustion',
  title: "Connection pool exhaustion and Little's Law",
  blurb: 'Requests queue for a fixed pool of connections. Make queries slower or triple the traffic, resize the pool, and compare waiting forever with failing fast on an acquire timeout.',
  placements: [
    { topic: 'db-connections-locks', heading: 'Long-running queries, layered timeouts' },
    { topic: 'db-scenarios', heading: 'Scenario 3' },
  ],
};
