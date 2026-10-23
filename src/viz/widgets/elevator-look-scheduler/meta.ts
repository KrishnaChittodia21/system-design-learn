import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'elevator-look-scheduler',
  title: 'Elevator scheduling: LOOK vs SCAN vs SSTF vs FCFS',
  blurb:
    'One car, hall calls (floor + direction) and cab calls. Step through the stops each policy makes, see LOOK pass a down-call on the way up and turn at the last request, and compare travel and worst wait, including SSTF starving a far floor.',
  placements: [
    { topic: 'lld-cases-1', heading: 'Elevator (3/3)' },
    { topic: 'lld-cases-1', heading: 'Elevator (2/3)' },
  ],
};
