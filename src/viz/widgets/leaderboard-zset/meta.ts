import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'leaderboard-zset',
  title: 'Leaderboard on a Redis sorted set: ZINCRBY, ZREVRANK and ties',
  blurb:
    'Each match win is one ZINCRBY. Watch the sorted set reorder, read the top 3 and your own rank with neighbours, compare the cost of a rank query in SQL and in a skip list, and switch tie-breaking from member name to "who got there first".',
  placements: [
    { topic: 'design-advanced', heading: 'Real-time gaming leaderboard (1/2)' },
    { topic: 'design-advanced', heading: 'Real-time gaming leaderboard (2/2)' },
  ],
};
