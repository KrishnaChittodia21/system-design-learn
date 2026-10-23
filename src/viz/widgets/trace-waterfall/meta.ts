import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'trace-waterfall',
  title: 'One request, five services: reading a trace waterfall',
  blurb:
    'Replay a checkout request span by span, then find the critical path and the span with the most self time. Switch the incident (slow DB, cache retries) and drop traceparent on one hop to see how broken propagation blames the wrong service.',
  placements: [
    { topic: 'observability', heading: 'Distributed tracing with OpenTelemetry' },
    { topic: 'observability', heading: 'Reading signals: a debugging playbook' },
  ],
};
