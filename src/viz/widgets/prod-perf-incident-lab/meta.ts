import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'prod-perf-incident-lab',
  title: 'Slowness war room: watch p99 explode, then fix the bottleneck',
  blurb:
    'Four incidents from this page (missing index, pool exhaustion, N+1, blocked event loop). Pick mitigations, let the incident develop, and see which fixes remove the saturation and which only move it.',
  placements: [
    { topic: 'prod-performance', heading: 'Incident 1 — Database slow' },
  ],
};
