import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'sql-joins',
  title: 'SQL joins and logical execution order',
  blurb: 'Pair customers with orders under INNER, LEFT, RIGHT, FULL OUTER and NOT EXISTS, row by row, with NULL-filled results. Then run a query clause by clause and watch a WHERE turn a LEFT JOIN into an inner join.',
  placements: [
    { topic: 'db-sql-fundamentals', heading: 'Joins by example' },
    { topic: 'db-sql-fundamentals', heading: 'NULL in joins and the LEFT JOIN + WHERE trap' },
    { topic: 'db-sql-fundamentals', heading: 'Logical query processing order' },
  ],
};
