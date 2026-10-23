import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'temporal-durable-replay',
  title: 'Temporal: crash a worker, replay the history',
  blurb:
    'Run an order workflow while the service records its event history, crash worker A mid-charge or mid-sleep, and watch worker B replay recorded results instead of re-executing them. Remove the idempotency key to get a double charge; ship v2 code without patched() to hit a non-determinism error.',
  placements: [
    { topic: 'platform-key-tech', heading: 'Temporal and durable execution' },
    { topic: 'platform-key-tech', heading: 'Temporal determinism, versioning' },
  ],
};
