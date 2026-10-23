import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'expand-contract-compat',
  title: 'Breaking changes: one release vs expand → contract',
  blurb:
    'Ship a rename, a new field, a new enum value or a newly required field to a web app, an iOS app and an external partner. See who breaks, what Pact catches (and misses), and why the contract step needs usage evidence, not a calendar.',
  placements: [{ topic: 'api-evolution', heading: '4. Expand' }],
};
