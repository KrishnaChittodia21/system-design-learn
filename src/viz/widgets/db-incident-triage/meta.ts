import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'db-incident-triage',
  title: 'The triage loop on four real incidents',
  blurb: 'Pick an incident and step through symptom → mitigate → what changed → USE → top queries → fix → prevent, with the dashboard and the evidence you would pull at each step, before and after.',
  placements: [{ topic: 'db-scenarios', heading: 'The triage loop' }],
};
