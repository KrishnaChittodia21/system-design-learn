import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'erasure-coding-durability',
  title: 'Replication vs erasure coding: kill nodes, count chunks',
  blurb:
    'Store one object as 3 copies, EC 4+2 or EC 8+4 across 4 racks, then fail nodes one by one. See how many failures each survives, degraded reads, storage overhead, read fan-out, and why repairing between failures is what really keeps the data.',
  placements: [{ topic: 'object-storage', heading: '4. Durability' }],
};
