import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'durability-path',
  title: 'The durability path: when is a commit really on disk?',
  blurb: 'Follow one record from a user-space buffer through the page cache and the drive’s write cache to NAND. Pick how you commit and which drive you have, then pull the plug at any step to see what survives.',
  placements: [{ topic: 'fund-os-kernel', heading: 'The durability path' }],
};
