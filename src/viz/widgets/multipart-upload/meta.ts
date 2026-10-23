import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'multipart-upload',
  title: 'Multipart upload with presigned part URLs',
  blurb:
    'Create → presign → PUT parts in parallel straight to the bucket → Complete. Change file and part size (hit the 10,000-part cap), add streams until the uplink saturates, drop one connection to see only that part retried, or close the tab to leave billed, invisible parts behind.',
  placements: [
    { topic: 'object-storage', heading: '6. Multipart upload' },
    { topic: 'object-storage', heading: '7. Presigned URLs' },
  ],
};
