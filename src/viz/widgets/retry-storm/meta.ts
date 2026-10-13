import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'retry-storm',
  title: 'Retry storms: amplification across layers',
  blurb:
    'A short outage in service B meets retries at every layer. Compare immediate retries, exponential backoff with full jitter, and a retry budget, and watch whether B recovers when the trigger ends.',
  placements: [
    { topic: 'rel-patterns', heading: '5. Retry storms' },
    { topic: 'misc-async-resilience', heading: 'Retries' },
    { topic: 'rel-production-judgment', heading: '9. Metastable failures' },
  ],
};
