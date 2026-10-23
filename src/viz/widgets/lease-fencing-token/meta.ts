import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'lease-fencing-token',
  title: 'Lease locks, a GC pause and fencing tokens',
  blurb: 'Client A takes a lease lock, then freezes in a GC pause. Stretch the pause past the TTL and B gets the lock too. Compare no token, re-checking the lease, and a fencing token the storage enforces.',
  placements: [{ topic: 'ds-concurrency', heading: 'Redlock, fencing tokens' }],
};
