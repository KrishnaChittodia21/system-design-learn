import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'cdn-edge-shield',
  title: 'CDN edges, origin shield and stale serving',
  blurb: 'Users in four regions hit their nearest PoP. Change the TTL, turn the shield and stale-while-revalidate on or off, then deploy, purge or break the origin and watch hits, Age, latency and origin load.',
  placements: [
    { topic: 'cdn-global', heading: 'Protecting the origin' },
  ],
};
