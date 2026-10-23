import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'solid-refactor-stepper',
  title: 'SOLID refactor stepper: what change is now cheap?',
  blurb:
    'Walk the topic’s examples from smell to fix (SRP and OCP on an invoice service, an LSP violation on cash-on-delivery, ISP and DIP on order ports) and replay real change requests against each stage to see which classes must be edited and which are simply added.',
  placements: [
    { topic: 'lld-oop-solid', heading: '4. SRP and OCP' },
    { topic: 'lld-oop-solid', heading: '5. LSP' },
    { topic: 'lld-oop-solid', heading: '6. ISP and DIP' },
  ],
};
