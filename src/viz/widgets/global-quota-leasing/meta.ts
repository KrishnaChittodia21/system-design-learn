import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'global-quota-leasing',
  title: 'Global rate limit across regions: central counter vs static split vs leased quota',
  blurb:
    'One API key may make 100 requests/s worldwide, served from three regions. Skew the traffic and shift it between regions, then compare an exact central counter (a cross-region round trip per request), a static per-region split and local buckets that lease tokens in batches.',
  placements: [{ topic: 'design-advanced', heading: 'Global rate limiter' }],
};
