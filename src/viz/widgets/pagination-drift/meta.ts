import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'pagination-drift',
  title: 'Offset vs cursor pagination under concurrent writes',
  blurb:
    'Scroll a newest-first feed while other users publish and delete posts. Offset pages slide under writes (duplicates, skipped rows) and read ever more rows; a keyset cursor stays anchored and costs limit + 1 per page.',
  placements: [{ topic: 'api-design', heading: '4. Collections: pagination' }],
};
