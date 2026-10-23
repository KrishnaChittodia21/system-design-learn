import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, KV_CAPACITY, MAX_BATCH, simulate, type Cell, type Kv, type Params, type Scheduler } from './sim';

const GX = 92;
const GX1 = 590;
const GY = 30;
const ROW = 21;
const KV_Y = 236;

const CELL: Record<Cell, { fill: string; stroke?: string; label: string } | null> = {
  none: null,
  done: null,
  wait: { fill: 'var(--warn-soft)', stroke: 'var(--warn)', label: 'queued' },
  prefill: { fill: 'var(--mag)', label: 'prefill (first token)' },
  decode: { fill: 'var(--accent)', label: 'decode (1 token)' },
  idle: { fill: 'var(--bad-soft)', stroke: 'var(--bad)', label: 'finished, slot idle' },
};

export default function LlmBatchingViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const steps = frames[frames.length - 1].step;
  const cw = (GX1 - GX) / steps;
  const kvScale = 584 / KV_CAPACITY;
  const inBatch = f.reqs.filter((r) => r.inBatch);
  const kvSlots = inBatch.map((r, i) => ({ r, x: 8 + inBatch.slice(0, i).reduce((a, q) => a + q.reserved * kvScale, 0) }));

  const aria = `Step ${Math.max(0, f.step)}: ${inBatch.length} sequences in the batch, ${f.tokensThisStep} tokens this step, ${f.tokensTotal} total. KV ${f.kvUsed} used of ${f.kvReserved} reserved, capacity ${KV_CAPACITY}.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Scheduler>
            label="Scheduler"
            value={params.scheduler}
            options={[
              { value: 'static', label: 'Static batches' },
              { value: 'continuous', label: 'Continuous batching' },
            ]}
            onChange={(scheduler) => setParams((p) => ({ ...p, scheduler }))}
          />
          <Choice<Kv>
            label="KV cache"
            value={params.kv}
            options={[
              { value: 'prealloc', label: 'Pre-allocate max tokens' },
              { value: 'paged', label: 'Paged blocks' },
            ]}
            onChange={(kv) => setParams((p) => ({ ...p, kv }))}
          />
        </>
      }
      legend={
        <>
          {(['wait', 'prefill', 'decode', 'idle'] as Cell[]).map((c) => (
            <span key={c}>
              <span className="viz-key" style={{ marginRight: 4, background: CELL[c]!.fill, border: CELL[c]!.stroke ? `1px solid ${CELL[c]!.stroke}` : undefined }} /> {CELL[c]!.label}
            </span>
          ))}
          <span>
            <span className="viz-key" style={{ marginRight: 4, background: 'var(--surface)', border: '1px dashed var(--warn)' }} /> KV reserved but empty
          </span>
        </>
      }
    >
      <svg viewBox="0 0 600 324" className="viz-svg" role="img" aria-label={aria}>
        <text x={8} y={16} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          request · prompt + answer tokens
        </text>
        <text x={GX1} y={16} textAnchor="end" fontSize={10.5} fontWeight={700}>
          forward pass {Math.max(0, f.step)} · batch {inBatch.length}/{MAX_BATCH}
        </text>
        {f.step >= 0 && f.step < steps && <rect x={GX + f.step * cw} y={GY - 4} width={cw} height={f.reqs.length * ROW + 4} rx={2} fill="var(--accent-soft)" />}
        {f.reqs.map((r, i) => {
          const y = GY + i * ROW;
          const row = f.grid[i];
          return (
            <g key={r.id}>
              <text x={8} y={y + 13} fontSize={10.5} fontWeight={700} style={{ fill: r.inBatch ? 'var(--accent)' : 'var(--text)' }}>
                {r.id}
              </text>
              <text x={30} y={y + 13} className="viz-label" style={{ fontSize: 9.5 }}>
                {r.prompt}+{r.out}
              </text>
              <line x1={GX} y1={y + ROW - 2} x2={GX1} y2={y + ROW - 2} stroke="var(--border)" strokeWidth={0.5} />
              <circle cx={GX + r.arrive * cw + 2} cy={y + 9} r={2.2} fill="var(--text-2)" />
              {row.map((c, s) => {
                const st = CELL[c];
                if (!st) return null;
                return <rect key={s} x={GX + s * cw + 0.6} y={y + 2} width={Math.max(1, cw - 1.2)} height={ROW - 6} rx={2} fill={st.fill} stroke={st.stroke ?? 'none'} strokeWidth={0.8} />;
              })}
              {r.finish !== null && r.finish <= f.step && (
                <text x={GX + (r.finish + 1) * cw + 3} y={y + 13} fontSize={8.5} style={{ fill: 'var(--good)' }}>
                  ✓
                </text>
              )}
            </g>
          );
        })}
        <text x={GX} y={GY + f.reqs.length * ROW + 10} fontSize={8.5} style={{ fill: 'var(--muted)' }}>
          step 0
        </text>
        <text x={GX1} y={GY + f.reqs.length * ROW + 10} textAnchor="end" fontSize={8.5} style={{ fill: 'var(--muted)' }}>
          step {steps - 1} · dot = arrival
        </text>

        {/* KV memory */}
        <text x={8} y={KV_Y - 6} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          GPU KV-cache memory ({KV_CAPACITY} tokens)
        </text>
        <text x={592} y={KV_Y - 6} textAnchor="end" fontSize={10.5} style={{ fill: 'var(--text-2)' }}>
          state {f.kvUsed} · reserved {f.kvReserved} · free {KV_CAPACITY - f.kvReserved}
        </text>
        <rect x={8} y={KV_Y} width={584} height={30} rx={5} fill="var(--surface)" stroke="var(--border)" />
        {kvSlots.map(({ r, x }) => {
          const wUsed = r.used * kvScale;
          const wRes = r.reserved * kvScale;
          return (
            <g key={r.id}>
              <rect x={x} y={KV_Y} width={wRes} height={30} fill="var(--surface)" stroke="var(--warn)" strokeDasharray="3 2" strokeWidth={1} />
              <rect x={x} y={KV_Y} width={wUsed} height={30} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1} />
              {wRes > 26 && (
                <text x={x + 4} y={KV_Y + 19} fontSize={9.5} fontWeight={700}>
                  {r.id}
                </text>
              )}
            </g>
          );
        })}

        {/* stats */}
        {[
          { label: 'tokens this pass', v: String(f.tokensThisStep) },
          { label: 'tokens streamed', v: String(f.tokensTotal) },
          { label: 'waiting', v: String(f.reqs.filter((r) => r.arrive <= Math.max(0, f.step) && r.start === null).length) },
          { label: 'KV waste', v: f.kvReserved ? `${Math.round(((f.kvReserved - f.kvUsed) / f.kvReserved) * 100)}%` : '—' },
        ].map((s, i) => (
          <g key={s.label}>
            <rect x={8 + i * 148} y={278} width={140} height={40} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
            <text x={16 + i * 148} y={294} className="viz-label" style={{ fontSize: 9.5 }}>
              {s.label}
            </text>
            <text x={16 + i * 148} y={312} fontSize={14} fontWeight={700}>
              {s.v}
            </text>
          </g>
        ))}
      </svg>
    </VizFrame>
  );
}
