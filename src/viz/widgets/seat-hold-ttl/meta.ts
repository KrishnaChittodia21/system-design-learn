import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'seat-hold-ttl',
  title: 'Seat holds with a TTL: lazy expiry, all-or-nothing, and the UNIQUE backstop',
  blurb:
    'Users race for seats in row A. Step through holds, an expiring lease that no timer cleans up, a late payment, and a Redis failover that makes the hold layer lie, then see which layer actually prevents a double booking.',
  placements: [{ topic: 'lld-cases-1', heading: 'BookMyShow (3/3)' }],
};
