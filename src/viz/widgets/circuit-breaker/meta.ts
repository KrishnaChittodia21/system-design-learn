import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'circuit-breaker',
  title: 'Circuit breaker: closed → open → half-open',
  blurb: 'Watch a downstream outage trip the breaker, fail fast, and probe its way back. Change the threshold and timeout.',
  placements: [
    { topic: 'rel-patterns', heading: '6. Circuit breakers' },
    { topic: 'misc-async-resilience', heading: 'Circuit Breaker' },
  ],
};
