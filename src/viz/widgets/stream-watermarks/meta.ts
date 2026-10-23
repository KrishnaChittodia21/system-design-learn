import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'stream-watermarks',
  title: 'Watermarks and late data in event-time windows',
  blurb:
    'Click events arrive out of order. Tune the watermark delay and watch 10-second windows fire later but more completely; choose what happens to events that arrive after their window fired.',
  placements: [{ topic: 'data-pipelines', heading: 'Event time vs processing time' }],
};
