import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'b-plus-tree',
  title: 'B+ tree: splits, copy-up vs move-up, and a range scan',
  blurb:
    'Insert 14 keys and watch leaves split, separators get copied up, internal splits move keys up and the root grow. Then scan 20 ≤ k ≤ 45 along the leaf links and compare with a B-tree in-order traversal.',
  placements: [
    { topic: 'db-indexing', heading: 'Index data structures compared: B-tree vs B+ tree' },
    { topic: 'db-indexing', heading: 'Index structures: B-tree vs LSM vs hash' },
  ],
};
