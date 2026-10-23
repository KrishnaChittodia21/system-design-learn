import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'estimation-chain',
  title: 'Back-of-envelope chain: DAU → QPS → storage → bandwidth → servers',
  blurb: 'Step through one estimate link by link. Drag any input and watch every downstream number change, including which one turns into a design decision.',
  placements: [{ topic: 'fund-estimation', heading: 'DAU → average QPS → peak QPS' }],
};
