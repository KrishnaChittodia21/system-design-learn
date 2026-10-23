import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'prod-idempotency-lab',
  title: '"Charged twice": retries, races and the idempotency key',
  blurb:
    'Replay a client timeout, a double-tap and a crash after the charge against no guard, check-then-insert, or an Idempotency-Key with a UNIQUE constraint, with and without forwarding the key to the payment provider. Count orders and captures.',
  placements: [{ topic: 'prod-correctness-ops', heading: '1. Incident: duplicate orders and double-charged payments' }],
};
