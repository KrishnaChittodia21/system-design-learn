import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'consumer-designs-flow',
  title: 'Consumer designs end to end: flash sale, price alerts, Tinder matches',
  blurb:
    'Pick a design and step through its core mechanism. Run a flash sale through the token check, bucketed Redis gate and unit rows (with a Redis failover) and confirm it never oversells; push price changes through validation, range-scan matching, hysteresis and the notify gate; race two right swipes into zero, one or two matches.',
  placements: [
    { topic: 'design-consumer', heading: 'Flash sale (2/3)' },
    { topic: 'design-consumer', heading: 'Flash sale (3/3)' },
    { topic: 'design-consumer', heading: 'Price tracker & alerts (2/3)' },
    { topic: 'design-consumer', heading: 'Tinder (2/3)' },
  ],
};
