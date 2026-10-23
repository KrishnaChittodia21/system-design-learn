import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'dr-region-failover',
  title: 'Region failure: where RPO and RTO come from',
  blurb: 'Fail region A, or replicate a bad DELETE, under backup & restore, active-passive or active-active. Tune replication lag, DNS TTL and human approval, and watch RTO decompose into detect + decide + recover + traffic shift.',
  placements: [
    { topic: 'rel-dr', heading: '4. RPO, RTO and the four DR tiers' },
    { topic: 'rel-dr', heading: '7. Failover automation and DNS TTL pitfalls' },
  ],
};
