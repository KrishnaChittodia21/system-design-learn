import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'quorum-reads-writes',
  title: 'Quorums: when R + W > N overlaps, and when it still lies',
  blurb: 'Set N, W and R, write while a replica is down, then read. See the overlap (or the stale read), and a read-during-write race that quorums alone do not prevent.',
  placements: [
    { topic: 'ds-consistency', heading: 'Quorums: N, R, W' },
    { topic: 'misc-distributed', heading: 'Quorum' },
  ],
};
