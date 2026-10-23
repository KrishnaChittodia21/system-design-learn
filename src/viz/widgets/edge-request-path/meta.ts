import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'edge-request-path',
  title: 'One request through the edge: CDN → WAF → LB → gateway → BFF',
  blurb: 'Send a cacheable asset, a signed-in home screen, an injection attempt, an expired token or a burst through the edge stack. Switch layers off to see which problem each one was quietly absorbing, and what it costs in latency.',
  placements: [{ topic: 'net-proxies-gateway', heading: 'The modern edge stack' }],
};
