import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'saga-vs-2pc',
  title: 'Checkout across services: 2PC vs saga',
  blurb: 'Run one checkout over Order, Inventory and Payment as two-phase commit or as an orchestrated saga. Make a step fail or crash the coordinator, and watch locks, in-doubt participants and compensations.',
  placements: [
    { topic: 'ds-transactions', heading: 'Two-phase commit (2PC)' },
    { topic: 'ds-transactions', heading: 'Sagas: long-lived transactions' },
    { topic: 'misc-distributed', heading: 'Distributed transactions / Saga' },
  ],
};
