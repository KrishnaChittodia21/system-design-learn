import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'async-race-locks',
  title: 'Races on one event loop: check-then-act, mutexes and lock ordering',
  blurb:
    'Two requests share an in-memory wallet. Step through how an await between the check and the write lets a double tap overdraw it, compare the fixes, then cross two transfers (A→B and B→A) and watch a silent async deadlock, withTimeout, and lock ordering.',
  placements: [{ topic: 'lld-patterns-concurrency', heading: 'Races in in-memory stores' }],
};
