import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'apps-designs-flow',
  title: 'App designs end to end: Instagram upload & fan-out, food-delivery order lifecycle',
  blurb:
    'Pick a design and step through it. Upload an Instagram photo through presigned URLs, the media pipeline (EXIF, renditions, moderation) and hybrid fan-out for a normal user or a celebrity; drive a food order through its table-driven state machine with acceptance timeouts, cancel-vs-accept races, late events and just-in-time partner offers.',
  placements: [
    { topic: 'design-apps', heading: 'Instagram (2/7)' },
    { topic: 'design-apps', heading: 'Instagram (4/7)' },
    { topic: 'design-apps', heading: 'Food delivery (4/7)' },
    { topic: 'design-apps', heading: 'Food delivery (5/7)' },
  ],
};
