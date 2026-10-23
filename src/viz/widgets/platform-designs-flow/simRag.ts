// RAG query path over a tiny pre-indexed corpus: BM25 and dense retrieval, Reciprocal Rank Fusion
// (k = 60), permission filtering inside retrieval vs after top-k, a cross-encoder rerank, and a
// grounded answer that cites chunk ids. Scores are illustrative toy numbers; the fusion and the
// filtering logic are exact.
import type { FlowEdge, FlowFrame, Tone } from './types';

export type Retrieval = 'dense' | 'bm25' | 'hybrid';
export type AclMode = 'pre' | 'post';
export type Viewer = 'agent' | 'contractor';

export interface RagParams {
  retrieval: Retrieval;
  acl: AclMode;
  viewer: Viewer;
}

export const QUERY = 'How long does a refund take after error E-1042?';
export const RRF_K = 60;
export const TOP_K = 4;
export const CONTEXT = 2;

export interface Chunk {
  id: string;
  path: string;
  acl: 'public' | 'support';
  bm25: number;
  dense: number;
  /** cross-encoder relevance */
  rerank: number;
  relevant: boolean;
}

export const CHUNKS: Chunk[] = [
  { id: 'c1', path: 'Errors > E-1042 > Meaning', acl: 'support', bm25: 9.1, dense: 0.62, rerank: 0.81, relevant: true },
  { id: 'c2', path: 'Refunds > Timeline', acl: 'public', bm25: 2.0, dense: 0.83, rerank: 0.88, relevant: true },
  { id: 'c3', path: 'Refunds > EU > Timeline', acl: 'public', bm25: 2.9, dense: 0.81, rerank: 0.42, relevant: false },
  { id: 'c4', path: 'Payments > Card declines', acl: 'public', bm25: 1.1, dense: 0.74, rerank: 0.12, relevant: false },
  { id: 'c5', path: 'Errors > E-1042 > Fix steps', acl: 'support', bm25: 8.4, dense: 0.58, rerank: 0.64, relevant: true },
  { id: 'c6', path: 'Changelog 2024 > E-1042 renamed', acl: 'support', bm25: 6.0, dense: 0.41, rerank: 0.2, relevant: false },
  { id: 'c7', path: 'Refunds > Money back FAQ', acl: 'public', bm25: 0.8, dense: 0.79, rerank: 0.55, relevant: true },
  { id: 'c8', path: 'Billing > Invoices', acl: 'public', bm25: 0.4, dense: 0.52, rerank: 0.05, relevant: false },
];

export const allowed = (c: Chunk, viewer: Viewer) => c.acl === 'public' || viewer === 'agent';

/** ids ordered by a score, best first */
export function ranking(chunks: Chunk[], key: 'bm25' | 'dense'): string[] {
  return [...chunks].sort((a, b) => b[key] - a[key]).map((c) => c.id);
}

/** Reciprocal Rank Fusion: score(d) = Σ 1 / (k + rank_i(d)), ranks starting at 1. */
export function rrf(lists: string[][], k = RRF_K): Map<string, number> {
  const m = new Map<string, number>();
  for (const list of lists) list.forEach((id, i) => m.set(id, (m.get(id) ?? 0) + 1 / (k + i + 1)));
  return m;
}

export interface RagRow extends Chunk {
  bmRank?: number;
  denseRank?: number;
  fused?: number;
  candidate: boolean;
  dropped?: 'acl';
  chosen: boolean;
}

export interface RagFrame extends FlowFrame {
  rows: RagRow[];
  answer: string;
  stage: number;
}

export function retrieve({ retrieval, acl, viewer }: RagParams) {
  const pool = acl === 'pre' ? CHUNKS.filter((c) => allowed(c, viewer)) : CHUNKS;
  const bm = ranking(pool, 'bm25');
  const de = ranking(pool, 'dense');
  let order: string[];
  let fused = new Map<string, number>();
  if (retrieval === 'bm25') order = bm;
  else if (retrieval === 'dense') order = de;
  else {
    fused = rrf([bm, de]);
    order = [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }
  const topk = order.slice(0, TOP_K);
  const afterAcl = acl === 'post' ? topk.filter((id) => allowed(CHUNKS.find((c) => c.id === id)!, viewer)) : topk;
  const reranked = [...afterAcl].sort((a, b) => CHUNKS.find((c) => c.id === b)!.rerank - CHUNKS.find((c) => c.id === a)!.rerank);
  const chosen = reranked.slice(0, CONTEXT);
  return { pool, bm, de, fused, topk, afterAcl, chosen };
}

export function simulateRag(params: RagParams): RagFrame[] {
  const { retrieval, acl, viewer } = params;
  const frames: RagFrame[] = [];
  const r = retrieve(params);
  const rows: RagRow[] = CHUNKS.map((c) => ({ ...c, candidate: false, chosen: false }));
  const row = (id: string) => rows.find((x) => x.id === id)!;
  let answer = '';
  let stage = 0;
  const snap = (active: Record<string, Tone>, edges: FlowEdge[], caption: string, predict?: string) =>
    frames.push({ active, edges, caption, predict, rows: rows.map((x) => ({ ...x })), answer, stage });
  const who = viewer === 'agent' ? 'a support agent (groups: support, public)' : 'a contractor (groups: public)';

  snap({}, [], `Ingestion already ran: documents were chunked by structure with their heading path, embedded, and indexed in BM25 and a vector index with ACLs on every chunk. Now ${who} asks: "${QUERY}"`);
  stage = 1;
  if (acl === 'pre') {
    for (const x of rows) if (!allowed(x, viewer)) x.dropped = 'acl';
    snap({ q: 'accent', acl: 'accent' }, [{ from: 'q', to: 'acl', label: 'principals', tone: 'accent' }], `Permission filter INSIDE retrieval: the query carries the user's principals, so both searches only ever see chunks the user may read${viewer === 'contractor' ? ' (the support-only E-1042 chunks are invisible)' : ' (everything here)'}.`);
  }
  r.bm.forEach((id, i) => (row(id).bmRank = i + 1));
  r.de.forEach((id, i) => (row(id).denseRank = i + 1));
  stage = 2;
  snap(
    { q: 'accent', bm25: retrieval !== 'dense' ? 'accent' : 'muted', vec: retrieval !== 'bm25' ? 'accent' : 'muted' },
    [
      ...(retrieval !== 'dense' ? [{ from: 'q', to: 'bm25', label: 'terms', tone: 'accent' as Tone }] : []),
      ...(retrieval !== 'bm25' ? [{ from: 'q', to: 'vec', label: 'embedding', tone: 'accent' as Tone }] : []),
    ],
    `BM25 nails the exact token "E-1042" (c1, c5, c6 on top); the dense embedding captures meaning ("how long… refund" ≈ refund timelines: c2, c3, c7) but barely knows the error code. ${retrieval === 'hybrid' ? 'Run both in parallel.' : `This run uses ${retrieval === 'bm25' ? 'BM25' : 'dense'} only.`}`,
  );
  stage = 3;
  if (retrieval === 'hybrid') for (const [id, s] of r.fused) row(id).fused = s;
  for (const id of r.topk) row(id).candidate = true;
  const fuseText =
    retrieval === 'hybrid'
      ? `Fuse with Reciprocal Rank Fusion, score = Σ 1/(60 + rank): ranks, not raw scores, so BM25's 9.1 and cosine 0.83 never need to be compared. Top ${TOP_K}: ${r.topk.map((id) => `${id} (${(r.fused.get(id)! * 1000).toFixed(2)}e-3)`).join(', ')}.`
      : `Top ${TOP_K} by ${retrieval === 'bm25' ? 'BM25' : 'cosine'} alone: ${r.topk.join(', ')}.${retrieval === 'bm25' ? ' The refund timeline itself is missing.' : ' The chunk that explains E-1042 is missing.'}`;
  snap({ fuse: 'accent', bm25: retrieval !== 'dense' ? 'accent' : 'muted', vec: retrieval !== 'bm25' ? 'accent' : 'muted' }, [{ from: 'bm25', to: 'fuse', tone: 'accent' }, { from: 'vec', to: 'fuse', tone: 'accent' }], fuseText, 'Next the permission filter (or nothing, if it already ran inside the search). How many of these candidates will survive?');
  stage = 4;
  if (acl === 'post') {
    for (const id of r.topk) if (!r.afterAcl.includes(id)) row(id).dropped = 'acl';
    snap(
      { acl: r.afterAcl.length < r.topk.length ? 'bad' : 'good', fuse: 'accent' },
      [{ from: 'fuse', to: 'acl', label: `post-filter top ${TOP_K}`, tone: r.afterAcl.length < r.topk.length ? 'bad' : 'good' }],
      `Post-filtering: retrieve top ${TOP_K}, then drop what the user may not read. ${r.topk.length - r.afterAcl.length} of ${TOP_K} dropped, ${r.afterAcl.length} left${
        r.afterAcl.length < r.topk.length ? '. The user gets a thinner (or empty) context even though allowed, relevant chunks existed further down, and the drop count itself leaks that hidden documents match.' : '.'
      }`,
    );
  } else snap({ acl: 'good', fuse: 'accent' }, [], `Already filtered inside the search, so all ${r.topk.length} candidates are readable by this user. Before the LLM, the final chunks are re-checked against the source of truth (index ACLs lag by minutes).`);
  stage = 5;
  for (const id of r.chosen) row(id).chosen = true;
  snap(
    { rerank: 'accent', acl: 'good' },
    [{ from: acl === 'pre' ? 'fuse' : 'acl', to: 'rerank', label: 'shortlist', tone: 'accent' }],
    r.chosen.length
      ? `A cross-encoder reads (query, chunk) pairs together and reorders the shortlist; keep the best ${CONTEXT}: ${r.chosen.map((id) => `${id} (${CHUNKS.find((c) => c.id === id)!.rerank})`).join(', ')}.`
      : 'Nothing survived to rerank.',
  );
  stage = 6;
  const rel = r.chosen.filter((id) => CHUNKS.find((c) => c.id === id)!.relevant);
  const hasCode = r.chosen.some((id) => id === 'c1' || id === 'c5');
  const hasTimeline = r.chosen.some((id) => id === 'c2' || id === 'c7');
  if (!r.chosen.length) answer = 'I could not find this in the documents you can access.';
  else if (hasCode && hasTimeline) answer = `E-1042 means the bank reversed the payment [${r.chosen.find((x) => x === 'c1' || x === 'c5')}]; refunds then arrive in 5–7 business days [${r.chosen.find((x) => x === 'c2' || x === 'c7')}].`;
  else if (hasTimeline) answer = `Refunds arrive in 5–7 business days [${r.chosen.find((x) => x === 'c2' || x === 'c7')}]. I found nothing about E-1042 in the documents you can access.`;
  else if (hasCode) answer = `E-1042 means the bank reversed the payment [${r.chosen.find((x) => x === 'c1' || x === 'c5')}]. The sources do not say how long the refund takes.`;
  else answer = 'The sources do not answer this.';
  snap(
    { llm: 'good', rerank: 'accent' },
    [{ from: 'rerank', to: 'llm', label: `${r.chosen.length} chunks + ids`, tone: 'good' }],
    `The prompt holds the question and ${r.chosen.length} chunks with ids, with instructions to answer only from them, cite every claim, and say "I don't know" otherwise. Relevant chunks in context: ${rel.length}/${r.chosen.length}. Citations are checked against the ids that were actually sent.`,
  );
  snap(
    { llm: 'good' },
    [],
    `Answer: "${answer}" ${
      hasCode && hasTimeline
        ? 'Hybrid retrieval gave the model both halves of the answer.'
        : viewer === 'contractor' && acl === 'pre' && retrieval === 'hybrid'
          ? 'The contractor may not read the E-1042 pages, so the honest answer says so instead of leaking them.'
          : acl === 'post' && viewer === 'contractor'
            ? `Post-filtering threw away ${r.topk.length - r.afterAcl.length} of ${TOP_K} candidates; filtering inside the search would have filled the context with chunks this user may read.`
            : 'Switch retrieval to hybrid to see what was missing.'
    } Measure this with recall@k on a golden set before tuning prompts.`,
  );
  return frames;
}
