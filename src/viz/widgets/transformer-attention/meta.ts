import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'transformer-attention',
  title: 'Self-attention, step by step: Q, K, V → softmax → next token',
  blurb:
    'Real numbers on a 5-token sentence: embeddings, Q/K/V projections, scaled dot-product scores, the causal mask, softmax weights and the weighted sum of values, then next-token probabilities with a temperature slider.',
  placements: [
    { topic: 'ai-fundamentals', heading: 'Self-attention step by step' },
    { topic: 'ai-fundamentals', heading: 'Decoder-only generation and sampling' },
  ],
};
