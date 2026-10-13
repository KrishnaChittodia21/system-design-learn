import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'replication-lag',
  title: 'Replication lag: read-your-writes on async replicas',
  blurb: 'A user saves, then refreshes from a lagging replica. Watch WAL positions per node and try the fixes: a primary window, LSN tokens, or sync replication.',
  placements: [
    { topic: 'db-replication', heading: 'Read-after-write' },
    { topic: 'misc-data', heading: 'Read Replicas' },
  ],
};
