import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'slo-error-budget-burn',
  title: 'Error budget burn and multi-window alerts',
  blurb:
    'Run an incident against an SLO and watch the 5 m, 30 m, 1 h and 6 h burn rates, the 30-day budget draining, and which multi-window alert pages. See why the long window stops blips and the short window lets the page clear after the fix.',
  placements: [
    { topic: 'observability', heading: 'Burn-rate alerting' },
    { topic: 'observability', heading: 'SLI, SLO, SLA and error budgets' },
  ],
};
