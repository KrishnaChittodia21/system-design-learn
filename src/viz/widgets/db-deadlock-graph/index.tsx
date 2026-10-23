import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { ENGINE_LABELS, ORDERING_LABELS, TICK_MS, simulate, type Engine, type Op, type Ordering, type Params, type RowId, type TxId, type TxStatus } from './sim';

const TX_COLOR: Record<TxId, string> = { T1: 'var(--blue)', T2: 'var(--mag)' };
const TX_SOFT: Record<TxId, string> = { T1: 'var(--blue-s)', T2: 'var(--mag-s)' };
const STATUS_COLOR: Record<TxStatus, string> = {
  pending: 'var(--muted)',
  running: 'var(--text)',
  waiting: 'var(--warn)',
  aborted: 'var(--bad)',
  backoff: 'var(--bad)',
  committed: 'var(--good)',
};
const STATUS_LABEL: Record<TxStatus, string> = {
  pending: 'not started',
  running: 'running',
  waiting: 'BLOCKED',
  aborted: 'aborted',
  backoff: 'aborted → backing off',
  committed: 'committed',
};

const opText = (op: Op) => (op.kind === 'lock' ? `UPDATE ${op.row} SET bal ${op.delta > 0 ? '+' : '−'} ${Math.abs(op.delta)}` : op.kind === 'work' ? '… app work …' : 'COMMIT');

const ROW_Y: Record<RowId, number> = { A: 44, B: 164 };
const NODE: Record<TxId, { x: number; y: number }> = { T1: { x: 470, y: 92 }, T2: { x: 550, y: 196 } };

export default function DbDeadlockGraphViz() {
  const [params, setParams] = useState<Params>({ ordering: 'natural', engine: 'postgres', offset: 0 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const ids: TxId[] = ['T1', 'T2'];
  const rows: RowId[] = ['A', 'B'];

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Ordering>
            label="Lock order"
            value={params.ordering}
            options={(Object.keys(ORDERING_LABELS) as Ordering[]).map((k) => ({ value: k, label: ORDERING_LABELS[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, ordering: v }))}
          />
          <Choice<Engine>
            label="Database"
            value={params.engine}
            options={(Object.keys(ENGINE_LABELS) as Engine[]).map((k) => ({ value: k, label: ENGINE_LABELS[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, engine: v }))}
          />
          <Slider label="T2 starts after T1" value={params.offset} min={0} max={3} onChange={(v) => setParams((p) => ({ ...p, offset: v }))} format={(v) => `${v * TICK_MS} ms`} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: TX_COLOR.T1 }} /> T1: A → B, 100
          <span className="viz-key" style={{ background: TX_COLOR.T2 }} /> T2: B → A, 50
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> blocked on a lock
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> cycle / aborted victim
        </>
      }
    >
      <svg
        viewBox="0 0 600 290"
        className="viz-svg"
        role="img"
        aria-label={`${f.t < 0 ? 'Before start' : `t=${f.t * TICK_MS} ms`}. T1 ${STATUS_LABEL[f.tx.T1.status]}, T2 ${STATUS_LABEL[f.tx.T2.status]}. Row A locked by ${f.owner.A ?? 'nobody'}, row B by ${f.owner.B ?? 'nobody'}. ${f.cycle ? 'The wait-for graph has a cycle: deadlock.' : ''} Deadlocks so far: ${f.deadlocks}.`}
      >
        <defs>
          <marker id="dl-arrow-warn" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--warn)" />
          </marker>
          <marker id="dl-arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--bad)" />
          </marker>
        </defs>
        <text x={8} y={16} className="viz-label">
          transactions
        </text>
        <text x={252} y={16} className="viz-label">
          rows (lock holder)
        </text>
        <text x={428} y={16} className="viz-label">
          wait-for graph
        </text>
        <text x={592} y={16} textAnchor="end" style={{ fontSize: 12, fontWeight: 700, fill: 'var(--text-2)' }}>
          {f.t < 0 ? '' : `t = ${f.t * TICK_MS} ms`}
        </text>

        {/* transaction panels */}
        {ids.map((id, k) => {
          const v = f.tx[id];
          const y0 = 26 + k * 128;
          const victim = f.victim === id;
          return (
            <g key={id}>
              <rect x={8} y={y0} width={226} height={118} rx={10} fill={TX_SOFT[id]} stroke={victim ? 'var(--bad)' : TX_COLOR[id]} strokeWidth={victim ? 3 : 1.5} />
              <text x={18} y={y0 + 20} style={{ fontSize: 13, fontWeight: 800, fill: TX_COLOR[id] }}>
                {id}
              </text>
              <text x={42} y={y0 + 20} style={{ fontSize: 11.5, fontWeight: 700, fill: STATUS_COLOR[v.status] }}>
                {victim ? (params.engine === 'postgres' ? '40P01 deadlock detected' : '1213 deadlock, rolled back') : STATUS_LABEL[v.status]}
              </text>
              {v.attempts > 1 && (
                <text x={224} y={y0 + 20} textAnchor="end" className="viz-label" style={{ fontSize: 10.5 }}>
                  attempt {v.attempts}
                </text>
              )}
              {v.ops.map((op, j) => {
                const done = j < v.pc;
                const current = j === v.pc && v.status !== 'committed' && v.status !== 'pending';
                const blocked = current && v.status === 'waiting';
                return (
                  <g key={j}>
                    {current && <rect x={14} y={y0 + 28 + j * 21} width={214} height={19} rx={5} fill={blocked ? 'var(--warn-soft)' : 'var(--surface)'} stroke={blocked ? 'var(--warn)' : 'var(--border-strong)'} />}
                    <text x={22} y={y0 + 42 + j * 21} style={{ fontSize: 11.5, fontFamily: 'var(--f-mono)', fill: done ? 'var(--muted)' : 'var(--text)', fontWeight: current ? 700 : 400 }}>
                      {done ? '✓ ' : current ? '▸ ' : '  '}
                      {opText(op)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* rows */}
        {rows.map((r) => {
          const o = f.owner[r];
          const y0 = ROW_Y[r];
          const dirty = f.value[r] !== f.committed[r];
          return (
            <g key={r}>
              <rect x={252} y={y0} width={156} height={84} rx={10} fill={o ? TX_SOFT[o] : 'var(--surface)'} stroke={o ? TX_COLOR[o] : 'var(--border-strong)'} strokeWidth={o ? 2.5 : 1.5} />
              <text x={264} y={y0 + 20} style={{ fontSize: 13, fontWeight: 800 }}>
                account {r}
              </text>
              <text x={264} y={y0 + 40} style={{ fontSize: 12, fontFamily: 'var(--f-mono)' }}>
                bal {f.value[r]}
              </text>
              <text x={264} y={y0 + 56} className="viz-label" style={{ fontSize: 10.5 }}>
                {dirty ? `uncommitted (others: ${f.committed[r]})` : 'committed'}
              </text>
              <text x={264} y={y0 + 74} style={{ fontSize: 11.5, fontWeight: 700, fill: o ? TX_COLOR[o] : 'var(--muted)' }}>
                {o ? `row lock held by ${o}` : 'unlocked'}
              </text>
            </g>
          );
        })}

        {/* wait-for graph */}
        {f.edges.map((e) => {
          const a = NODE[e.from];
          const b = NODE[e.to];
          const col = f.cycle ? 'var(--bad)' : 'var(--warn)';
          // offset the two directions so a 2-cycle shows two distinct arrows
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          const nx = (-dy / len) * 12;
          const ny = (dx / len) * 12;
          const sx = a.x + (dx / len) * 26 + nx;
          const sy = a.y + (dy / len) * 26 + ny;
          const ex = b.x - (dx / len) * 28 + nx;
          const ey = b.y - (dy / len) * 28 + ny;
          return (
            <g key={`${e.from}-${e.to}`}>
              <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={col} strokeWidth={2.5} markerEnd={`url(#dl-arrow-${f.cycle ? 'bad' : 'warn'})`} />
              <text x={(sx + ex) / 2 + nx * 2.6} y={(sy + ey) / 2 + ny * 2.2 + 4} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 700, fill: col }}>
                wants {e.row}
              </text>
            </g>
          );
        })}
        {ids.map((id) => {
          const v = f.tx[id];
          const n = NODE[id];
          return (
            <g key={id}>
              <circle cx={n.x} cy={n.y} r={24} fill={TX_SOFT[id]} stroke={f.victim === id ? 'var(--bad)' : TX_COLOR[id]} strokeWidth={f.victim === id ? 3.5 : 2} opacity={v.status === 'committed' || v.status === 'pending' ? 0.45 : 1} />
              <text x={n.x} y={n.y + 5} textAnchor="middle" style={{ fontSize: 13, fontWeight: 800, fill: TX_COLOR[id] }}>
                {id}
              </text>
            </g>
          );
        })}
        <text x={510} y={244} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: f.cycle ? 'var(--bad)' : f.edges.length ? 'var(--warn)' : 'var(--muted)' }}>
          {f.cycle ? 'CYCLE = deadlock' : f.edges.length ? 'a wait, not a cycle' : 'no waits'}
        </text>

        <text x={8} y={282} className="viz-label">
          deadlocks: <tspan style={{ fontWeight: 700, fill: f.deadlocks ? 'var(--bad)' : 'var(--text)' }}>{f.deadlocks}</tspan> · committed A + B ={' '}
          <tspan style={{ fontWeight: 700 }}>{f.committed.A + f.committed.B}</tspan> (must stay 800){f.done ? ` · both done at ${f.t * TICK_MS} ms` : ''}
        </text>
      </svg>
    </VizFrame>
  );
}
