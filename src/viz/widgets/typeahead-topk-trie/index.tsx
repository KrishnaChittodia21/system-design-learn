import { useMemo, useState } from 'react';
import './typeahead.css';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { COUNTS, DEFAULT_PARAMS, buildTrie, simulate, type Params, type Query } from './sim';

const TREE_X0 = 18;
const TREE_X1 = 410;
const LEVEL_Y = (d: number) => 22 + d * 40;

function useLayout() {
  return useMemo(() => {
    const nodes = buildTrie(Object.keys(COUNTS));
    const pos = new Map<string, { x: number; y: number }>();
    const leaves: string[] = [];
    const walk = (p: string) => {
      const n = nodes.get(p)!;
      if (!n.children.length) leaves.push(p);
      n.children.forEach(walk);
    };
    walk('');
    const step = (TREE_X1 - TREE_X0) / (leaves.length - 1);
    const place = (p: string): number => {
      const n = nodes.get(p)!;
      const x = n.children.length ? n.children.map(place).reduce((a, b) => a + b, 0) / n.children.length : TREE_X0 + leaves.indexOf(p) * step;
      pos.set(p, { x, y: LEVEL_Y(n.depth) });
      return x;
    };
    place('');
    return { nodes, pos };
  }, []);
}

export default function TypeaheadTrieViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const { nodes, pos } = useLayout();
  const current = f.typed;
  const maxCount = Math.max(...Object.values(f.counts));

  const aria = f.typed
    ? `Prefix "${f.typed}": cached top ${params.k} is ${f.list.map((x) => `${x.word} ${x.count}`).join(', ')}.`
    : 'Trie of 12 queries, nothing typed yet.';

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <div className="tkt-raw-chips">
          <Choice<Query>
            label="User types"
            value={params.query}
            options={[
              { value: 'bea', label: '"bea"' },
              { value: 'tre', label: '"tre"' },
              { value: 'b', label: '"b"' },
            ]}
            onChange={(query) => setParams((p) => ({ ...p, query }))}
          />
          </div>
          <Slider label="Cached list size k" value={params.k} min={1} max={4} onChange={(k) => setParams((p) => ({ ...p, k }))} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> walked path
          <span className="viz-key" style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn)' }} /> subtree a cache-less lookup scans
          <span className="viz-key" style={{ background: 'var(--mag-s)', border: '1.5px solid var(--mag)' }} /> cached list rewritten
          <span className="viz-key ring" /> complete query (double ring)
        </>
      }
    >
      <svg viewBox="0 0 600 300" className="viz-svg" role="img" aria-label={aria}>
        {/* edges */}
        {[...nodes.values()].flatMap((n) =>
          n.children.map((c) => {
            const a = pos.get(n.prefix)!;
            const b = pos.get(c)!;
            const onPath = f.path.includes(c);
            return <line key={c} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={onPath ? 'var(--accent)' : 'var(--border)'} strokeWidth={onPath ? 2.6 : 1.2} />;
          }),
        )}
        {/* nodes */}
        {[...nodes.values()].map((n) => {
          const { x, y } = pos.get(n.prefix)!;
          const onPath = f.path.includes(n.prefix);
          const cur = n.prefix === current && current !== '';
          const scanned = f.scan.includes(n.prefix) && !cur;
          const rewritten = f.rewritten.includes(n.prefix);
          const trend = f.trending === n.prefix;
          const r = cur ? 11 : 9;
          return (
            <g key={n.prefix || 'root'}>
              <circle cx={x} cy={y} r={r} fill="var(--surface)" />
              <circle
                cx={x}
                cy={y}
                r={r}
                fill={onPath ? 'var(--accent)' : rewritten ? 'var(--mag-s)' : scanned ? 'var(--warn-soft)' : 'var(--surface)'}
                stroke={rewritten ? 'var(--mag)' : onPath ? 'var(--accent)' : scanned ? 'var(--warn)' : 'var(--line-2)'}
                strokeWidth={rewritten || cur ? 2.4 : 1.4}
                style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
              />
              {n.terminal && <circle cx={x} cy={y} r={r + 3} fill="none" stroke={trend ? 'var(--mag)' : 'var(--line-2)'} strokeWidth={trend ? 2 : 1} />}
              <text x={x} y={y + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} style={{ fill: onPath ? 'var(--surface)' : 'var(--text)' }}>
                {n.prefix ? n.prefix[n.prefix.length - 1] : '∅'}
              </text>
              {n.terminal && (
                <text x={x} y={y + r + 14} textAnchor="middle" fontSize={8.5} style={{ fill: trend ? 'var(--mag)' : 'var(--text-2)' }} fontWeight={trend ? 700 : 400}>
                  {f.counts[n.prefix]}
                </text>
              )}
            </g>
          );
        })}

        {/* cached list panel */}
        <rect x={430} y={8} width={162} height={176} rx={8} fill="var(--surface-2)" stroke={f.typed ? 'var(--accent)' : 'var(--border)'} strokeWidth={f.typed ? 2 : 1.2} />
        <text x={438} y={24} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          {f.typed ? `cached top-${params.k} at "${f.typed}"` : 'search box'}
        </text>
        <rect x={438} y={32} width={146} height={24} rx={6} fill="var(--surface)" stroke="var(--line-2)" />
        <text x={446} y={49} fontSize={12} fontFamily="var(--f-mono)" fontWeight={700}>
          {f.typed}
          <tspan style={{ fill: 'var(--accent)' }}>▍</tspan>
        </text>
        {f.list.map((x, i) => (
          <g key={x.word}>
            <rect x={438} y={64 + i * 28} width={146} height={24} rx={5} fill={x.word === f.trending ? 'var(--mag-s)' : 'var(--surface)'} stroke={x.word === f.trending ? 'var(--mag)' : 'var(--border)'} />
            <rect x={438} y={84 + i * 28} width={(146 * x.count) / maxCount} height={4} rx={2} fill="var(--accent)" opacity={0.7} style={{ transition: 'width 0.3s ease' }} />
            <text x={446} y={80 + i * 28} fontSize={11.5} fontWeight={600}>
              {x.word}
            </text>
            <text x={578} y={80 + i * 28} textAnchor="end" fontSize={10.5} style={{ fill: 'var(--text-2)' }}>
              {x.count}
            </text>
          </g>
        ))}

        {/* cost */}
        <rect x={430} y={192} width={162} height={100} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
        <text x={438} y={208} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          work per keystroke
        </text>
        <text x={438} y={230} fontSize={11}>
          with cache: <tspan fontWeight={700} style={{ fill: 'var(--good)' }}>{f.typed ? f.typed.length + 1 : 0} nodes</tspan>
        </text>
        <text x={438} y={250} fontSize={11}>
          without: <tspan fontWeight={700} style={{ fill: 'var(--warn)' }}>{f.scan.length || '—'} nodes</tspan>
        </text>
        <text x={438} y={270} className="viz-label" style={{ fontSize: 9.5 }}>
          walk O(prefix) + read O(1)
        </text>
        <text x={438} y={284} className="viz-label" style={{ fontSize: 9.5 }}>
          vs scan + sort the subtree
        </text>
      </svg>
    </VizFrame>
  );
}
