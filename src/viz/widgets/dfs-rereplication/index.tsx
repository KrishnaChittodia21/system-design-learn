import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, RF, simulate, type Failure, type Params, type Placement } from './sim';

const NODE_W = 86;
const NODE_Y = 188;
const NODE_H = 124;
const nodeX = (i: number) => (i < 3 ? 16 + i * 94 : 312 + (i - 3) * 94);

export default function DfsRereplicationViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const idx = (id: string) => f.nodes.findIndex((n) => n.id === id);
  const copied = (node: string, block: string) => f.copies.some((c) => c.to === node && c.block === block);

  const aria = `${f.clock}. ${f.blocks.map((b) => `${b.id} has ${b.live.length} live replica${b.live.length === 1 ? '' : 's'}`).join(', ')}. ${f.queue.length} queued for re-replication.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Placement>
            label="Replica placement"
            value={params.placement}
            options={[
              { value: 'rack', label: 'Rack-aware' },
              { value: 'random', label: 'Random' },
            ]}
            onChange={(placement) => setParams((p) => ({ ...p, placement }))}
          />
          <Choice<Failure>
            label="Failure"
            value={params.failure}
            options={[
              { value: 'node', label: 'One DataNode' },
              { value: 'rack', label: 'Whole rack R1' },
            ]}
            onChange={(failure) => setParams((p) => ({ ...p, failure }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good-soft)', border: '1px solid var(--good)' }} /> live replica
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> just cloned
          <span className="viz-key" style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad)' }} /> replica on a dead node
        </>
      }
    >
      <svg viewBox="0 0 600 336" className="viz-svg" role="img" aria-label={aria}>
        <defs>
          <marker id="dfs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
          </marker>
        </defs>

        {/* NameNode block map */}
        <rect x={8} y={6} width={396} height={162} rx={8} fill="var(--surface-2)" stroke={f.phase === 'dead' ? 'var(--warn)' : 'var(--border)'} strokeWidth={f.phase === 'dead' ? 2 : 1.2} />
        <text x={16} y={22} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          NameNode · block map for /logs/day1
        </text>
        {f.blocks.map((b, i) => {
          const y = 40 + i * 21;
          const n = b.live.length;
          const tone = n === 0 ? 'bad' : n < RF ? 'warn' : 'good';
          const chips = [...b.live.map((id) => ({ id, live: true })), ...b.gone.map((id) => ({ id, live: false }))];
          return (
            <g key={b.id}>
              <text x={16} y={y + 12} fontSize={11.5} fontWeight={700}>
                {b.id}
              </text>
              {chips.map((c, k) => {
                const x = 48 + k * 52;
                const fresh = c.live && copied(c.id, b.id);
                return (
                  <g key={c.id}>
                    <rect
                      x={x}
                      y={y}
                      width={46}
                      height={16}
                      rx={4}
                      fill={fresh ? 'var(--accent)' : c.live ? 'var(--good-soft)' : 'var(--bad-soft)'}
                      stroke={fresh ? 'var(--accent)' : c.live ? 'var(--good)' : 'var(--bad)'}
                    />
                    <text x={x + 23} y={y + 12} textAnchor="middle" fontSize={10} fontWeight={600} textDecoration={c.live ? undefined : 'line-through'} style={{ fill: fresh ? 'var(--surface)' : c.live ? 'var(--text)' : 'var(--bad)' }}>
                      {c.id} {RACK_LABEL(c.id)}
                    </text>
                  </g>
                );
              })}
              <text x={396} y={y + 12} textAnchor="end" fontSize={11} fontWeight={700} style={{ fill: `var(--${tone})` }}>
                {n === 0 ? 'LOST' : `${n}/${RF}`}
              </text>
            </g>
          );
        })}

        {/* queue */}
        <rect x={412} y={6} width={180} height={162} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
        <text x={420} y={22} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          re-replication queue
        </text>
        <text x={584} y={22} textAnchor="end" fontSize={10.5} fontWeight={700} style={{ fill: 'var(--accent)' }}>
          {f.clock}
        </text>
        {f.queue.length === 0 && (
          <text x={420} y={44} fontSize={10.5} style={{ fill: 'var(--muted)' }}>
            {f.phase === 'silent' ? 'waiting for the dead-node timeout' : 'empty'}
          </text>
        )}
        {f.queue.slice(0, 6).map((q, i) => (
          <text key={q.id} x={420} y={44 + i * 19} fontSize={11}>
            {i + 1}. <tspan fontWeight={700}>{q.id}</tspan> · {q.live} live{' '}
            <tspan style={{ fill: q.live === 1 ? 'var(--bad)' : 'var(--warn)' }} fontWeight={700}>
              {q.live === 1 ? 'urgent' : ''}
            </tspan>
          </text>
        ))}

        {/* racks */}
        {(['R1', 'R2'] as const).map((r, ri) => {
          const down = f.nodes.filter((n) => n.rack === r).every((n) => !n.up);
          return (
            <g key={r}>
              <rect x={8 + ri * 296} y={176} width={288} height={142} rx={10} fill="none" stroke={down ? 'var(--bad)' : 'var(--border)'} strokeDasharray="5 4" strokeWidth={1.4} />
              <text x={16 + ri * 296} y={188} fontSize={10} fontWeight={700} style={{ fill: down ? 'var(--bad)' : 'var(--muted)' }}>
                rack {r}
                {down ? ' · switch down' : ''}
              </text>
            </g>
          );
        })}
        {f.nodes.map((n, i) => {
          const x = nodeX(i);
          const tone = n.dead ? 'bad' : !n.up ? 'warn' : null;
          return (
            <g key={n.id}>
              <rect
                x={x}
                y={NODE_Y + 4}
                width={NODE_W}
                height={NODE_H - 8}
                rx={8}
                fill={tone ? `var(--${tone}-soft)` : 'var(--surface)'}
                stroke={tone ? `var(--${tone})` : 'var(--border)'}
                strokeWidth={tone ? 2 : 1.2}
                style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
              />
              <text x={x + 8} y={NODE_Y + 20} fontSize={11.5} fontWeight={700}>
                {n.id}
              </text>
              <text x={x + NODE_W - 8} y={NODE_Y + 20} textAnchor="end" fontSize={9.5} fontWeight={700} style={{ fill: n.dead ? 'var(--bad)' : !n.up ? 'var(--warn)' : 'var(--good)' }}>
                {n.dead ? 'dead ✕' : !n.up ? 'silent' : '♥ 3 s'}
              </text>
              {n.blocks.map((b, k) => {
                const bx = x + 8 + (k % 2) * 36;
                const by = NODE_Y + 28 + Math.floor(k / 2) * 20;
                const fresh = copied(n.id, b);
                return (
                  <g key={b}>
                    <rect x={bx} y={by} width={32} height={16} rx={3} fill={fresh ? 'var(--accent)' : n.dead ? 'var(--bad-soft)' : 'var(--good-soft)'} stroke={fresh ? 'var(--accent)' : n.dead ? 'var(--bad)' : 'var(--good)'} opacity={n.dead ? 0.7 : 1} />
                    <text x={bx + 16} y={by + 12} textAnchor="middle" fontSize={9.5} fontWeight={600} style={{ fill: fresh ? 'var(--surface)' : 'var(--text)' }}>
                      {b}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* clone arrows */}
        {f.copies.map((c, k) => {
          const a = idx(c.from);
          const b = idx(c.to);
          const x1 = nodeX(a) + NODE_W / 2;
          const x2 = nodeX(b) + NODE_W / 2;
          const y = NODE_Y + NODE_H - 6;
          const dip = 14 + k * 6;
          return (
            <path
              key={k}
              d={`M${x1},${y} C${x1},${y + dip} ${x2},${y + dip} ${x2},${y + 2}`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              markerEnd="url(#dfs-arrow)"
            />
          );
        })}
      </svg>
    </VizFrame>
  );
}

function RACK_LABEL(id: string) {
  return ['D1', 'D2', 'D3'].includes(id) ? '·R1' : '·R2';
}
