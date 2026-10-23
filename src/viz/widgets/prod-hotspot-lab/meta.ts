import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'prod-hotspot-lab',
  title: 'Hot spots: one node melts while its peers idle',
  blurb:
    'A celebrity key, a range-sharded timestamp, sticky sessions behind a CGNAT. Watch per-node utilisation and the max ÷ median skew, then try fixes: some cool the hot node, some only add capacity where it is not needed.',
  placements: [
    { topic: 'prod-scale', heading: '8. Incident: one shard is overloaded' },
  ],
};
