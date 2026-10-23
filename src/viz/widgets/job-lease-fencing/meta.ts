import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'job-lease-fencing',
  title: 'Job scheduler: leases, fencing tokens and retries',
  blurb:
    'Two workers claim due jobs with SKIP LOCKED and a lease. W1 freezes in a long GC pause and a transient error forces a retry with backoff. Change the lease length and turn fencing tokens off to see a zombie worker overwrite a newer result.',
  placements: [{ topic: 'design-infra', heading: 'Distributed Job Scheduler (1/2)' }],
};
