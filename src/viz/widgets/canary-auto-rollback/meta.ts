import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'canary-auto-rollback',
  title: 'Rolling vs blue/green vs automated canary',
  blurb:
    'Release a version that fails 0.3–10% of requests (or a good one) and watch who notices first: a burn-rate page plus a human, or a canary compared with a baseline that rolls back on its own. Count the error budget each strategy burns.',
  placements: [{ topic: 'misc-ops', heading: 'Canary deployment' }],
};
