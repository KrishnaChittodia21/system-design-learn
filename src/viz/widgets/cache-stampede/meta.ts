import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'cache-stampede',
  title: 'Cache stampede: one hot key expires under load',
  blurb: 'A hot key expires while many requests arrive. Compare no protection, a lock, stale-while-revalidate and XFetch by DB load and user wait.',
  placements: [
    { topic: 'cache-failures', heading: 'Cache stampede (dogpile' },
    { topic: 'misc-caching-redis', heading: 'Cache stampede' },
  ],
};
