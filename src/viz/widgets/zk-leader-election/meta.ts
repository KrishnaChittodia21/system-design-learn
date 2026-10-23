import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'zk-leader-election',
  title: 'ZooKeeper election: ephemeral sequential znodes and watches',
  blurb:
    'Clients race to create EPHEMERAL_SEQUENTIAL znodes; the lowest leads and each waiter watches only its predecessor. Pause the leader until its session expires, compare with a herd of watchers, see a fencing token reject the old leader, and break the recipe with a lost create reply.',
  placements: [
    { topic: 'platform-key-tech', heading: 'ZooKeeper recipes done right' },
    { topic: 'platform-key-tech', heading: 'ZooKeeper internals' },
  ],
};
