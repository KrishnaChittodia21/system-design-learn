import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'dynamodb-hot-partition',
  title: 'DynamoDB: one viral key vs the 1,000 WCU partition ceiling',
  blurb:
    'Keys hash onto partitions; a viral item throttles while the table has headroom. Step through burst capacity, adaptive capacity isolating the key (still capped), then write sharding. Tune write rate, item size (WCU per write) and shard count.',
  placements: [{ topic: 'platform-key-tech', heading: 'Throughput in practice' }],
};
