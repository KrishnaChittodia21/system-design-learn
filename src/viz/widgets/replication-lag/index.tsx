import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { FIX_LABELS, TICKS, lags, simulate, type Fix, type NodeId, type Params } from './sim';

const NODE_STYLE: Record<NodeId, { color: string; label: string; short: string }> = {
  primary: { color: 'var(--text)', label: 'primary', short: 'P' },
  r1: { color: 'var(--accent)', label: 'replica-1', short: '1' },
  r2: { color: 'var(--warn)', label: 'replica-2', short: '2' },
};
const NODES: NodeId[] = ['primary', 'r1', 'r2'];

export default function ReplicationLagViz() {
  const [params, setParams] = useState<Params>({ lag: 2, fix: 'none', window: 3 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const L = lags(params.lag);

  // chart geometry
  const X0 = 112;
  const X1 = 588;
  const cw = (X1 - X0) / TICKS;
  const Y0 = 34; // top
  const Y1 = 196; // bottom
  const lsnMin = 100;
  const lsnMax = 100 + TICKS + 1;
  const y = (lsn: number) => Y1 - ((lsn - lsnMin) / (lsnMax - lsnMin)) * (Y1 - Y0);
  const x = (t: number) => X0 + t * cw + cw / 2;
  const cur = f.lsnHistory[f.lsnHistory.length - 1];

  const path = (node: NodeId) =>
    f.lsnHistory
      .map((h, t) => {
        const xl = X0 + t * cw;
        return `${t === 0 ? 'M' : 'L'}${xl},${y(h[node])} L${xl + cw},${y(h[node])}`;
      })
      .join(' ');

  const lastRead = f.op === 'read' ? f.reads[f.reads.length - 1] : undefined;
  const status =
    f.op === 'commit-wait'
      ? 'user: saving… commit waits for replica-1 to apply'
      : f.op === 'write'
        ? 'user: saved "Ann" (commit returned)'
        : lastRead
          ? `user: refresh served by ${NODE_STYLE[lastRead.node].label} → "${lastRead.fresh ? 'Ann' : 'Ana'}"`
          : 'user: idle';

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Replica lag" value={params.lag} min={0} max={6} onChange={(v) => setParams((p) => ({ ...p, lag: v }))} format={(v) => `${v} tick${v === 1 ? '' : 's'} (replica-2: ${v + 2})`} />
          <Choice<Fix>
            label="Fix"
            value={params.fix}
            options={(Object.keys(FIX_LABELS) as Fix[]).map((k) => ({ value: k, label: FIX_LABELS[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, fix: v }))}
          />
          {params.fix === 'window' && (
            <Slider label="Primary window N" value={params.window} min={1} max={8} onChange={(v) => setParams((p) => ({ ...p, window: v }))} format={(v) => `${v} tick${v === 1 ? '' : 's'}`} />
          )}
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--text)' }} /> primary WAL
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> replica-1 replay LSN
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> replica-2 replay LSN
          <span className="viz-key" style={{ background: 'var(--good)' }} /> read saw the write
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> stale read
        </>
      }
    >
      <svg
        viewBox="0 0 600 312"
        className="viz-svg"
        role="img"
        aria-label={`${f.tick < 0 ? 'Before start' : `Tick ${f.tick}`}. ${cur ? `Primary LSN ${cur.primary}, replica-1 ${cur.r1}, replica-2 ${cur.r2}. ` : ''}User write is LSN ${f.userLsn}. ${status}. ${f.staleReads} stale reads so far.`}
      >
        <text x={8} y={18} className="viz-label">
          WAL position (LSN) per node over time
        </text>
        <text x={592} y={18} textAnchor="end" style={{ fontSize: 12, fontWeight: 600, fill: lastRead ? (lastRead.fresh ? 'var(--good)' : 'var(--bad)') : 'var(--text-2)' }}>
          {status}
        </text>

        {/* axes */}
        <line x1={X0} y1={Y1} x2={X1} y2={Y1} stroke="var(--border)" />
        <line x1={X0} y1={Y0} x2={X0} y2={Y1} stroke="var(--border)" />

        {/* write + ack markers */}
        <rect x={X0 + f.writeTick * cw} y={Y0} width={Math.max(cw, (f.ackTick - f.writeTick + 1) * cw)} height={Y1 - Y0} fill="var(--accent-soft)" opacity={f.tick >= f.writeTick ? 1 : 0.35} />
        <text x={x(f.writeTick)} y={Y0 + 12} textAnchor="middle" className="viz-label">
          write
        </text>

        {/* user's write LSN */}
        <line x1={X0} y1={y(f.userLsn)} x2={X1} y2={y(f.userLsn)} stroke="var(--good)" strokeDasharray="6 4" strokeWidth={1.5} />
        <text x={X1 - 4} y={y(f.userLsn) + 14} textAnchor="end" style={{ fontSize: 11, fill: 'var(--good)', fontWeight: 600 }}>
          write LSN {f.userLsn}
        </text>

        {/* window marker */}
        {params.fix === 'window' && (
          <g>
            <line x1={X0 + (f.writeTick + params.window) * cw} y1={Y0} x2={X0 + (f.writeTick + params.window) * cw} y2={Y1 + 34} stroke="var(--accent)" strokeDasharray="3 3" />
            <text x={X0 + (f.writeTick + params.window) * cw + 3} y={Y0 + 10} className="viz-label">
              window ends
            </text>
          </g>
        )}

        {/* current tick */}
        {f.tick >= 0 && <rect x={X0 + f.tick * cw} y={Y0} width={cw} height={Y1 - Y0 + 70} fill="var(--surface-2)" opacity={0.6} />}

        {/* LSN step lines */}
        {f.lsnHistory.length > 0 &&
          NODES.slice()
            .reverse()
            .map((n) => <path key={n} d={path(n)} fill="none" stroke={NODE_STYLE[n].color} strokeWidth={n === 'primary' ? 2.5 : 2.2} strokeLinejoin="round" />)}

        {/* node labels with current LSN */}
        {NODES.map((n, k) => (
          <g key={n}>
            <text x={8} y={Y0 + 34 + k * 40} style={{ fontSize: 12, fontWeight: 700, fill: NODE_STYLE[n].color }}>
              {NODE_STYLE[n].label}
            </text>
            <text x={8} y={Y0 + 49 + k * 40} className="viz-label">
              {cur ? `LSN ${cur[n]}` : 'LSN 100'}
              {n !== 'primary' ? ` · lag ${L[n]}` : ''}
            </text>
          </g>
        ))}

        {/* reads row */}
        <text x={X0 - 6} y={Y1 + 34} textAnchor="end" className="viz-label">
          refreshes
        </text>
        {Array.from({ length: TICKS }, (_, t) => {
          const rd = f.reads.find((r) => r.t === t);
          return (
            <g key={t}>
              {rd ? (
                <>
                  <circle cx={x(t)} cy={Y1 + 30} r={9} fill={rd.fresh ? 'var(--good)' : 'var(--bad)'} className="viz-dot" />
                  <text x={x(t)} y={Y1 + 34} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700, fill: 'var(--surface-2)' }}>
                    {NODE_STYLE[rd.node].short}
                  </text>
                </>
              ) : (
                <circle cx={x(t)} cy={Y1 + 30} r={3} fill="var(--border)" />
              )}
              {t % 2 === 0 && (
                <text x={x(t)} y={Y1 + 58} textAnchor="middle" className="viz-label">
                  t{t}
                </text>
              )}
            </g>
          );
        })}

        <text x={8} y={304} className="viz-label">
          stale reads: <tspan style={{ fontWeight: 700, fill: f.staleReads ? 'var(--bad)' : 'var(--text)' }}>{f.staleReads}</tspan> · reads on primary: {f.primaryReads}
          {params.fix === 'sync' ? ` · commit latency: +${params.lag} tick${params.lag === 1 ? '' : 's'}` : ' · commit latency: +0'} · letters show who served each read (P, 1, 2)
        </text>
      </svg>
    </VizFrame>
  );
}
