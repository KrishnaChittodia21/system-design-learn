import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'feed-fanout',
  title: 'News feed fan-out: push vs pull vs hybrid',
  blurb: 'Post as normal users and a celebrity, then open your feed. Compare timeline writes (write amplification) with read-time lookups for push, pull and the hybrid, and drag the celebrity\'s follower count.',
  placements: [
    { topic: 'design-social', heading: 'News Feed (2/3)' },
    { topic: 'design-patterns', heading: 'Scaling Reads' },
  ],
};
