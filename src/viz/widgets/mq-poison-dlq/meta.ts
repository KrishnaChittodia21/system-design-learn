import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'mq-poison-dlq',
  title: 'Poison pills: in-place retry vs retry topics vs DLQ',
  blurb:
    'One malformed message and one flaky one in a keyed partition. Retry in place and watch lag climb behind the poison pill; move failures to delayed retry topics and a DLQ to keep the partition flowing, at the cost of per-key order.',
  placements: [{ topic: 'mq-scenarios', heading: 'Scenario: repeated failures' }],
};
