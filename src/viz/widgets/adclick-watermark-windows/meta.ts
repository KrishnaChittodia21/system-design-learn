import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'adclick-watermark-windows',
  title: 'Ad clicks per window: event time, watermarks and late events',
  blurb:
    'Clicks arrive late and out of order. Count them in 10-second tumbling windows by event time or by processing time, drag the allowed lateness and choose what happens to a click that arrives after its window fired. Compare each emitted count with the true count.',
  placements: [{ topic: 'design-infra', heading: 'Ad Click Aggregation (3/4)' }],
};
