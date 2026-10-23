import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'dfs-rereplication',
  title: 'DFS: rack-aware placement, heartbeats and re-replication',
  blurb:
    'A NameNode tracks six blocks with three replicas each across two racks. Kill one DataNode or a whole rack and watch missed heartbeats turn into a prioritised, throttled re-replication queue. Switch to random placement to see how a rack failure can lose every copy of a block.',
  placements: [{ topic: 'design-storage', heading: 'Distributed file system (3/3)' }],
};
