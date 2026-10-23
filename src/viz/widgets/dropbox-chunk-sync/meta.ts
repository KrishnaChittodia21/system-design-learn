import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'dropbox-chunk-sync',
  title: 'File sync: chunking, content hashes, dedup and conflicted copies',
  blurb:
    'A real file is split into blocks and each block is named by its hash. Edit it with fixed-size or content-defined chunks and watch which blocks must be uploaded, how the second laptop syncs only the delta, and how an offline edit becomes a conflicted copy.',
  placements: [
    { topic: 'design-storage', heading: 'Dropbox / Google Drive (3/4)' },
    { topic: 'design-storage', heading: 'Dropbox / Google Drive (4/4)' },
  ],
};
