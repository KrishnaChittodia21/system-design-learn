import type { VizMeta } from '../../core';

export const meta: VizMeta = {
  id: 'platform-designs-flow',
  title: 'Platform designs end to end: brokerage, CI runners, chess, calendar, RAG',
  blurb:
    'Pick a design and step through its core mechanism: a buy order from buying-power reservation through FIX fills; CI jobs dispatched by global FIFO vs weighted fair share onto warm or cold runners; server-authoritative chess clocks with capped lag credit; a free/busy query across three time zones before and after DST; and a RAG query through BM25, vectors, RRF, ACL filtering and reranking.',
  placements: [
    { topic: 'design-platform', heading: 'Brokerage (2/3)' },
    { topic: 'design-platform', heading: 'CI/CD runner (2/3)' },
    { topic: 'design-platform', heading: 'Online chess (2/3)' },
    { topic: 'design-platform', heading: 'Calendar (2/3)' },
    { topic: 'design-platform', heading: 'RAG (2/3)' },
  ],
};
