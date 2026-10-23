import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'realtime-transports',
  title: 'Short polling vs long polling vs SSE vs WebSocket on one timeline',
  blurb: 'The same server events and the same RTT, delivered four ways over 60 seconds. Compare delivery delay, wasted empty responses, held connections and what each costs at 10M clients.',
  placements: [{ topic: 'net-realtime', heading: '1. The decision space' }],
};
