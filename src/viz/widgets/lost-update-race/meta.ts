import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'lost-update-race',
  title: 'Lost update: read-modify-write vs atomic, CAS and FOR UPDATE',
  blurb: 'Two requests add to the same balance. Shift when the second one starts and switch strategy: plain read-then-write silently loses money, while an atomic UPDATE, a version check with retry, or a row lock all land on 180.',
  placements: [
    { topic: 'ds-concurrency', heading: 'Race conditions: check-then-act' },
    { topic: 'ds-concurrency', heading: 'Optimistic locking' },
  ],
};
