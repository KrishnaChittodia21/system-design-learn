import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'kafka-isr-acks',
  title: 'Partition replication: ISR, high watermark and producer acks',
  blurb:
    'One partition, three replicas. Produce messages, let a follower fall out of the ISR, then crash the leader. Switch acks between 1 and all and change min.insync.replicas to see when an acknowledged write is lost and when the broker refuses a write instead.',
  placements: [{ topic: 'design-infra', heading: 'Distributed Message Queue (3/3)' }],
};
