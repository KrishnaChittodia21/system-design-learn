import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'search-inverted-index',
  title: 'Inverted index: analyse, post, intersect, score with BM25',
  blurb:
    'Watch five product titles get tokenised, stemmed and turned into posting lists, then run a query: look up the lists, intersect or union them, and rank the candidates with BM25. Tune b and k1 to see length normalisation and tf saturation change the winner.',
  placements: [
    { topic: 'search-systems', heading: 'The inverted index' },
    { topic: 'search-systems', heading: 'Relevance: BM25' },
  ],
};
