import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'sharding-hotspots',
  title: 'Shard keys, hotspots and resharding with logical shards',
  blurb: 'Spread a skewed workload by hash or range, find the hot shard, add a node by moving logical shards, then fix the hot key itself.',
  placements: [
    { topic: 'db-sharding', heading: 'Sharding strategies' },
    { topic: 'db-sharding', heading: 'Hot shards' },
    { topic: 'misc-data', heading: 'Sharding' },
  ],
};
