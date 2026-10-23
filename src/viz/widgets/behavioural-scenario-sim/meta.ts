import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'behavioural-scenario-sim',
  title: 'Scenario walk-through: signals vs traps, beat by beat',
  blurb:
    'Pick a prompt (design disagreement, incident, failure, influence, mentoring) and tell it in four beats by choosing a response each time. See which signals each choice conveys, which traps it trips, and a scored debrief built from the topic’s scoring table.',
  placements: [{ topic: 'beh-scenarios', heading: '1. How scenario prompts are scored' }],
};
