// Turns an incident timeline (incidents.ts) into frames: cumulative component states, the phase
// strip, and an impact line. With `guard` on, the timeline branches after the trigger into the
// "what if the fix had existed" illustration.
import type { BaseFrame } from '../../core';
import { INCIDENTS, type Incident, type NodeState, type Phase, type Step } from './incidents';

export interface Params {
  incident: string;
  guard: boolean;
}

export interface Frame extends BaseFrame {
  step?: Step;
  index: number;
  states: Record<string, NodeState>;
  timeline: Step[];
}

export const PHASE_LABEL: Record<Phase, string> = {
  trigger: 'Trigger',
  spread: 'Why it spread',
  detect: 'Detection',
  mitigate: 'Mitigation',
  recover: 'Recovery',
  lesson: 'Lesson',
  'what-if': 'What-if (our illustration)',
};

export const incidentById = (id: string): Incident => INCIDENTS.find((x) => x.id === id) ?? INCIDENTS[0];

export function timelineOf(inc: Incident, guard: boolean): Step[] {
  return guard ? [...inc.steps.slice(0, inc.guard.branchAfter + 1), ...inc.guard.steps] : inc.steps;
}

export function simulate({ incident, guard }: Params): Frame[] {
  const inc = incidentById(incident);
  const timeline = timelineOf(inc, guard);
  const states: Record<string, NodeState> = Object.fromEntries(inc.nodes.map((n) => [n.id, 'ok' as NodeState]));
  const frames: Frame[] = [
    {
      index: -1,
      states: { ...states },
      timeline,
      caption: `${inc.label}, ${inc.when}. Failure shape: ${inc.shape}. ${
        guard ? `This replay branches after "${PHASE_LABEL[timeline[inc.guard.branchAfter].phase]}" into what the announced fix (${inc.guard.label}) would have changed. That branch is our illustration, not part of the postmortem.` : 'Step through what happened, as the topic tells it.'
      }`,
    },
  ];
  timeline.forEach((st, i) => {
    Object.assign(states, st.set ?? {});
    const branchNext = guard && i === inc.guard.branchAfter;
    frames.push({
      step: st,
      index: i,
      states: { ...states },
      timeline,
      caption: `${st.time === 'what-if' ? '' : `${st.time} · `}${PHASE_LABEL[st.phase]}: ${st.text}`,
      predict:
        st.phase === 'trigger' && !guard
          ? 'What turns this local event into a wide outage?'
          : branchNext
            ? `Now imagine "${inc.guard.label}" had been in place. Which component behaves differently?`
            : undefined,
    });
  });
  return frames;
}
