import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'load-balancing',
  title: 'Load balancing: round robin vs least connections vs P2C',
  blurb: 'Dispatch the same traffic three ways across a fleet with one slow server. Watch in-flight work and queues per server, and the p99. Change the slow latency and the request rate.',
  placements: [{ topic: 'net-load-balancing', heading: 'Balancing algorithms and where each breaks' }],
};
