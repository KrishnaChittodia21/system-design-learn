import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'db-deadlock-graph',
  title: 'Deadlocks: the wait-for graph, the victim and lock ordering',
  blurb: 'Two transfers lock the same two rows in opposite order. Watch the wait-for graph close into a cycle, see Postgres or InnoDB pick a victim, then switch to sorted lock order and the cycle cannot form.',
  placements: [
    { topic: 'db-connections-locks', heading: 'Deadlocks: detection, prevention and retries' },
    { topic: 'ds-concurrency', heading: 'Deadlocks: detection, prevention and retry' },
  ],
};
