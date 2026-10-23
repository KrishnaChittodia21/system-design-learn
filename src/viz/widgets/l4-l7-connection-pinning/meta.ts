import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'l4-l7-connection-pinning',
  title: 'L4 vs L7: connection pinning with HTTP/2 and gRPC',
  blurb:
    'Six gRPC clients with uneven traffic, four pods, then a scale-out. An L4 balancer pins each long-lived connection to one pod, so new pods sit idle; compare max connection age, connection-per-request and an L7 proxy that balances every request.',
  placements: [{ topic: 'misc-traffic-edge', heading: 'L4 vs L7' }],
};
