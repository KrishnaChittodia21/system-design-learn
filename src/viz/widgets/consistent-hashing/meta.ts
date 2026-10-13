import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'consistent-hashing',
  title: 'Consistent hashing: ring, vnodes and what moves',
  blurb: 'Map keys clockwise onto a ring, then add and remove a node. Count the keys that move and compare with hash % N. Change the vnodes and see the load even out.',
  placements: [
    { topic: 'net-load-balancing', heading: 'Consistent hashing with virtual nodes' },
    { topic: 'db-sharding', heading: 'Resharding: consistent hashing' },
  ],
};
