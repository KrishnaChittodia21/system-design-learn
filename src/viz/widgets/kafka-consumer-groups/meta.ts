import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'kafka-consumer-groups',
  title: 'Kafka consumer groups: partitions, offsets and rebalancing',
  blurb:
    'Keyed messages land in partitions, one consumer owns each partition, and committed offsets decide what is replayed. Add consumers, trigger rebalances and crash a consumer before it commits.',
  placements: [
    { topic: 'mq-fundamentals', heading: 'Consumer groups and rebalancing' },
    { topic: 'mq-fundamentals', heading: 'Offsets and commit strategies' },
    { topic: 'misc-async-resilience', heading: 'Kafka rebalancing' },
  ],
};
