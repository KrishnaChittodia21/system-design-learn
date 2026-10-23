import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'payment-idempotency-ledger',
  title: 'Pay-in: idempotency keys, webhooks, double-entry ledger and reconciliation',
  blurb:
    'A ₹1,000 checkout where the PSP response times out. Turn idempotency off to see a timeout treated as a failure and the card charged twice, lose the webhook to see a payment stuck in PROCESSING, then let the nightly reconciliation against the settlement file repair the ledger.',
  placements: [{ topic: 'design-commerce', heading: 'Payment system (3/3)' }],
};
