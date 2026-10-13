import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'netflix-counter',
  title: "Netflix's Distributed Counter: event log → rollups → GetCount",
  blurb:
    'AddCount events with idempotency tokens land in time-bucketed logs, and rollups aggregate only immutable windows. Compare best-effort, eventually consistent and accurate counters, retry a lost ack, and change the rollup lag to see how reads converge.',
  placements: [{ topic: 'design-more', heading: "Netflix's Distributed Counter Abstraction" }],
};
