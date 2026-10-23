import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'geo-designs-flow',
  title: 'Location designs end to end: geohash proximity search, Uber matching',
  blurb:
    'Pick a design. Encode a location into a geohash bit by bit, search its cell and the 8 neighbours, filter by true distance and see when the radius outgrows the cells (or let a quadtree adapt to density); then match a rider with driver pings, ring expansion over cells, road ETA instead of straight-line distance, and compare-and-set offers that can never double-book a driver.',
  placements: [
    { topic: 'design-geo', heading: 'Proximity Service (2/3)' },
    { topic: 'design-geo', heading: 'Uber (1/3)' },
    { topic: 'design-geo', heading: 'Uber (2/3)' },
  ],
};
