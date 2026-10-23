import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'live-abr-ladder',
  title: 'Live stream: transcode ladder, segments and adaptive bitrate',
  blurb:
    'The stadium feed is transcoded into a 4-rung ladder with aligned keyframes and packaged into segments. Squeeze the viewer\'s bandwidth and watch the player pick a rendition segment by segment from its throughput estimate and buffer. Compare with a fixed 1080p player and change the segment length to trade latency for robustness.',
  placements: [
    { topic: 'design-modern', heading: 'Live streaming (2/3)' },
    { topic: 'design-modern', heading: 'Live streaming (3/3)' },
  ],
};
