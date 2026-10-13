import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'normalization',
  title: 'Normalisation: UNF → 1NF → 2NF → 3NF → BCNF',
  blurb: 'Split an orders table step by step. See which functional dependency each step removes, replay an update, insert or delete anomaly before and after, and join the pieces back to prove nothing was lost.',
  placements: [
    { topic: 'db-sql-fundamentals', heading: 'Normalization 1NF → 3NF' },
    { topic: 'db-sql-fundamentals', heading: 'BCNF, 4NF and 5NF' },
    { topic: 'db-fundamentals', heading: 'Relational model and why normalization exists' },
  ],
};
