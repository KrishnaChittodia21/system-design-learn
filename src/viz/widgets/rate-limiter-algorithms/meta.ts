import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'rate-limiter-algorithms',
  title: 'Rate limiters side by side: token bucket, fixed and sliding window',
  blurb: 'Feed one bursty stream to three limiters and see which requests each allows. Watch the fixed window leak 2× at the boundary. Tune the limit, refill rate and burst size.',
  placements: [
    { topic: 'rate-limiting', heading: '4. Sliding window counter' },
    { topic: 'rate-limiting', heading: '5. Token bucket' },
    { topic: 'lld-cases-2', heading: 'Rate limiter (2/3)' },
  ],
};
