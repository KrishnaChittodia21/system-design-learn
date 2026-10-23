import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'docs-ot-crdt',
  title: 'Concurrent edits: naive apply vs OT vs CRDT',
  blurb:
    'Two people edit "abc" at the same time from the same revision. Pick a conflict (insert vs delete, two inserts at one spot, two deletes of one character) and see naive replay diverge, server-sequenced OT transform the second op, and a CRDT merge by character ids.',
  placements: [
    { topic: 'design-modern', heading: 'Google Docs (2/3)' },
    { topic: 'design-modern', heading: 'Google Docs (3/3)' },
  ],
};
