import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'llm-continuous-batching',
  title: 'LLM serving: static vs continuous batching and KV-cache memory',
  blurb:
    'Eight chat requests with different prompt and answer lengths hit one GPU. Step through decode iterations and compare static batching (wait for the longest answer) with continuous batching (join and leave every step), and pre-allocated KV memory with PagedAttention blocks.',
  placements: [{ topic: 'design-modern', heading: 'LLM chat service (3/3)' }],
};
