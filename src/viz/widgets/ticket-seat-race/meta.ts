import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'ticket-seat-race',
  title: 'Seat race: naive booking vs atomic holds with a TTL',
  blurb:
    'Four fans race for eight seats. Compare a naive read-then-write booking flow with an atomic all-or-nothing hold (Redis Lua) plus a guarded DB confirm, and drag the hold TTL to decide whether a slow payment beats the expiry.',
  placements: [{ topic: 'design-commerce', heading: 'Ticket booking (1/2)' }],
};
