import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'strangler-fig-migration',
  title: 'Strangler fig: moving one route out of a monolith',
  blurb:
    'Step through facade → seam → new service with CDC → shadow diff → canary 1/10/50/100% → flip data ownership → delete. Pick a decoupled first slice or the core checkout to see sync calls back into the monolith multiply latency and failure.',
  placements: [
    { topic: 'microservices', heading: 'Strangler fig migration' },
    { topic: 'microservices', heading: 'The distributed monolith' },
  ],
};
