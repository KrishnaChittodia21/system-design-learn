import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'scaling-journey',
  title: 'Scaling journey: from one box to multi-region, one bottleneck at a time',
  blurb: 'Drag traffic from the first user past a million. Each stage first shows the measured bottleneck on today’s architecture, then the smallest change that removes it, and the new failure mode it brings.',
  placements: [{ topic: 'fund-scaling-journey', heading: 'The running example and the pizza-shop map' }],
};
