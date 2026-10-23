import { useState, type ReactNode } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { Box, Edge, Halo, Key, Markers, Panel, Pill, type NodeDef } from './kit';
import { QUERY, simulateRag, type AclMode, type RagParams, type Retrieval, type Viewer } from './sim';

const COLS = [18, 46, 232, 290, 344, 398, 478];

export default function RagView({ picker }: { picker: ReactNode }) {
  const [params, setParams] = useState<RagParams>({ retrieval: 'hybrid', acl: 'post', viewer: 'contractor' });
  const frames = useSimulation(simulateRag, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const pre = params.acl === 'pre';
  const nodes: Record<string, NodeDef> = {
    q: { id: 'q', label: 'Query', sub: 'user + groups', x: 4, y: 34, w: 86, h: 42 },
    bm25: { id: 'bm25', label: 'BM25', sub: 'exact terms', x: 118, y: 4, w: 86, h: 40 },
    vec: { id: 'vec', label: 'Vector index', sub: 'meaning', x: 118, y: 66, w: 86, h: 40 },
    fuse: { id: 'fuse', label: 'RRF', sub: 'k = 60, top 4', x: 230, y: 34, w: 80, h: 42 },
    acl: pre ? { id: 'acl', label: 'ACL filter', sub: 'inside search', x: 4, y: 96, w: 86, h: 40 } : { id: 'acl', label: 'ACL filter', sub: 'after top-k', x: 330, y: 34, w: 80, h: 42 },
    rerank: { id: 'rerank', label: 'Reranker', sub: 'keep 2', x: 430, y: 34, w: 76, h: 42 },
    llm: { id: 'llm', label: 'LLM', sub: 'cite ids', x: 524, y: 34, w: 72, h: 42 },
  };
  const links: [string, string][] = [
    ['q', 'bm25'],
    ['q', 'vec'],
    ['bm25', 'fuse'],
    ['vec', 'fuse'],
    ...(pre ? ([['q', 'acl'], ['fuse', 'rerank']] as [string, string][]) : ([['fuse', 'acl'], ['acl', 'rerank']] as [string, string][])),
    ['rerank', 'llm'],
  ];
  const aria = `RAG step ${stepper.i + 1}: ${f.rows.filter((r) => r.candidate).length} candidates, ${f.rows.filter((r) => r.chosen).length} chunks sent to the model. ${f.answer ? `Answer: ${f.answer}` : ''}`;

  return (
    <VizFrame
      title="RAG query: retrieve, fuse, filter, rerank, cite"
      blurb={`"${QUERY}" over eight indexed chunks. Compare dense, BM25 and hybrid retrieval, filter permissions inside the search or after top-k, and switch the user.`}
      stepper={stepper}
      controls={
        <>
          {picker}
          <Choice<Retrieval>
            label="Retrieval"
            value={params.retrieval}
            options={[
              { value: 'dense', label: 'Dense only' },
              { value: 'bm25', label: 'BM25 only' },
              { value: 'hybrid', label: 'Hybrid + RRF' },
            ]}
            onChange={(retrieval) => setParams((p) => ({ ...p, retrieval }))}
          />
          <Choice<AclMode>
            label="Permissions"
            value={params.acl}
            options={[
              { value: 'pre', label: 'Inside the search' },
              { value: 'post', label: 'After top-k' },
            ]}
            onChange={(acl) => setParams((p) => ({ ...p, acl }))}
          />
          <Choice<Viewer>
            label="User"
            value={params.viewer}
            options={[
              { value: 'agent', label: 'Support agent' },
              { value: 'contractor', label: 'Contractor (public only)' },
            ]}
            onChange={(viewer) => setParams((p) => ({ ...p, viewer }))}
          />
        </>
      }
      legend={
        <>
          <Key tone="accent" /> top-k candidate
          <Key tone="good" /> sent to the LLM
          <Key tone="bad" /> dropped by ACL
          <Key tone="muted" /> not retrieved / not visible
        </>
      }
    >
      <svg viewBox="0 0 600 358" className="viz-svg" role="img" aria-label={aria}>
        <Markers />
        {links.map(([a, b]) => (
          <Edge key={`${a}-${b}`} a={nodes[a]} b={nodes[b]} dashed />
        ))}
        {Object.values(nodes).map((n) => (
          <Box key={n.id} n={n} tone={f.active[n.id]} />
        ))}
        {f.edges.map((e, k) => (
          <Edge key={`${stepper.i}-${k}`} a={nodes[e.from]} b={nodes[e.to]} tone={e.tone} label={e.label} labelDy={e.from === 'q' ? -2 : 32} packet k={`${stepper.i}-${k}`} />
        ))}

        <Panel x={8} y={144} w={584} h={166} title="Chunks (heading path travels with each chunk)">
          {['id', 'heading path', 'ACL', 'BM25 #', 'dense #', 'RRF ×10⁻³', 'status'].map((h, k) => (
            <text key={h} x={COLS[k]} y={174} fontSize={9.5} fontWeight={700} className="pdf-muted">
              {h}
            </text>
          ))}
          {f.rows.map((r, k) => {
            const y = 192 + k * 15;
            const hidden = r.dropped === 'acl' && pre;
            const status = r.chosen ? 'in prompt' : r.dropped === 'acl' ? (pre ? 'invisible' : 'dropped (ACL)') : r.candidate ? 'candidate' : '';
            const tone = r.chosen ? 'good' : r.dropped === 'acl' && !pre ? 'bad' : r.candidate ? 'accent' : 'muted';
            return (
              <g key={r.id} opacity={hidden ? 0.45 : 1}>
                <text x={COLS[0]} y={y} fontSize={10} fontWeight={800}>
                  {r.id}
                </text>
                <text x={COLS[1]} y={y} fontSize={9.5}>
                  {r.path}
                </text>
                <text x={COLS[2]} y={y} fontSize={9.5} style={{ fill: r.acl === 'support' ? 'var(--warn)' : 'var(--ink-3)' }}>
                  {r.acl}
                </text>
                <text x={COLS[3]} y={y} fontSize={9.5} fontFamily="var(--f-mono)">
                  {f.stage >= 2 && r.bmRank ? r.bmRank : hidden ? '–' : ''}
                </text>
                <text x={COLS[4]} y={y} fontSize={9.5} fontFamily="var(--f-mono)">
                  {f.stage >= 2 && r.denseRank ? r.denseRank : hidden ? '–' : ''}
                </text>
                <text x={COLS[5]} y={y} fontSize={9.5} fontFamily="var(--f-mono)">
                  {r.fused ? (r.fused * 1000).toFixed(2) : ''}
                </text>
                {status && <Pill x={COLS[6]} y={y - 2} text={status} tone={tone} size={8.5} />}
              </g>
            );
          })}
        </Panel>
        {(f.answer ? `Answer: ${f.answer}` : 'Answer: (not generated yet)').split(/(?<=[.;]) /).map((line, k) => (
          <Halo key={k} x={8} y={326 + k * 14} anchor="start" text={line} size={10.5} weight={700} tone={f.answer ? 'good' : undefined} />
        ))}
      </svg>
    </VizFrame>
  );
}
