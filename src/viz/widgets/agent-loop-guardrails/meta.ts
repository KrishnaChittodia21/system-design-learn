import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'agent-loop-guardrails',
  title: 'The agent loop: plan, call tools, observe, stop',
  blurb:
    'Run a fintech support agent through its loop: the model proposes tool calls, the runtime validates and executes them against a tool registry, and budgets decide when it must stop. Inject a malicious UPI remark, make a tool keep timing out, toggle the guardrails and shrink the step budget.',
  placements: [
    { topic: 'design-agents', heading: 'The agent loop' },
    { topic: 'design-agents', heading: 'Tool calling and tool schemas' },
    { topic: 'design-agents', heading: 'Security: prompt injection' },
    { topic: 'design-agents', heading: 'Worked design: a customer-support agent' },
  ],
};
