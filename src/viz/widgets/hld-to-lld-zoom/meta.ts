import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'hld-to-lld-zoom',
  title: 'Zoom from an HLD box into its LLD',
  blurb:
    'Pick the box worth designing, then walk the topic’s URL shortener down the 8 rungs: requirements, API, entities, class diagram, seams, patterns, the custom-alias race (naive find-then-save vs insertIfAbsent) and additive follow-ups.',
  placements: [
    { topic: 'lld-hld-to-lld', heading: '2. The HLD-first → LLD flow' },
    { topic: 'lld-hld-to-lld', heading: '3. Reading an HLD' },
    { topic: 'lld-hld-to-lld', heading: '6. Worked example (3/3)' },
  ],
};
