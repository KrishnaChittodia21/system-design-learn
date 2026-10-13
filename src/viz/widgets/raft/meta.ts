import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'raft',
  title: 'Raft: elections, terms and majority commit',
  blurb:
    'Five nodes elect a leader with randomised timeouts, replicate entries with AppendEntries and commit on a majority. Crash the leader or partition it away and watch terms and logs repair.',
  placements: [
    { topic: 'ds-consensus', heading: 'Raft leader election' },
    { topic: 'ds-consensus', heading: 'Raft log replication' },
    { topic: 'misc-distributed', heading: 'Raft' },
  ],
};
