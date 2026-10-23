import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'smr-total-order',
  title: 'Replicas, concurrent claims and total order broadcast',
  blurb: 'Two users claim the same username at different replicas at the same time. Compare applying messages on arrival, Lamport timestamps, and a sequencer that totally orders them, then crash R2 and see which approach still makes progress.',
  placements: [{ topic: 'ds-theory', heading: 'State machine replication and total order broadcast' }],
};
