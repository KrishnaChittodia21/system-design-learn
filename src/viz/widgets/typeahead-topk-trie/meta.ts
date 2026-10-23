import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'typeahead-topk-trie',
  title: 'Typeahead: a trie where every node caches its top-k',
  blurb:
    'Type a query one keystroke at a time and watch the lookup walk down the trie and read the cached top-k list at the prefix node, instead of scanning the whole subtree. Then a term starts trending and the rebuild refreshes only the lists on its path.',
  placements: [{ topic: 'design-advanced', heading: 'Search autocomplete / typeahead' }],
};
