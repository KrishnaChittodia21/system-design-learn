import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'prod-cascade-lab',
  title: 'Slow is worse than down: one dependency drains the socket pool',
  blurb:
    'Recommendations slows down and /checkout, which never calls it, starts failing. Watch the shared socket pool fill up, then add a timeout, a bulkhead or a circuit breaker and see which one actually protects checkout.',
  placements: [
    { topic: 'prod-async-failure', heading: '8. Incident: a downstream is slow' },
  ],
};
