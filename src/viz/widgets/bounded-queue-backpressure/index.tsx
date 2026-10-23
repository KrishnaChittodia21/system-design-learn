import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { BURST_TICKS, DEFAULT_PARAMS, ITEM_KB, simulate, type Params, type Policy } from './sim';

const Q_X0 = 140;
const Q_X1 = 470;
const Q_Y = 34;
const CH_X0 = 40;
const CH_X1 = 590;
const CH_Y0 = 132;
const CH_Y1 = 236;

export default function BoundedQueueViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const last = frames[frames.length - 1];
  const bounded = params.policy !== 'unbounded';
  const slots = bounded ? params.capacity : Math.max(params.capacity, ...last.depth, 1);
  const slotW = Math.min(30, (Q_X1 - Q_X0) / slots);
  const qLeft = Q_X1 - slots * slotW;
  const tMax = Math.max(1, last.tick);
  const yMax = Math.max(params.capacity, ...last.depth, 1);
  const cx = (t: number) => CH_X0 + (t / tMax) * (CH_X1 - CH_X0);
  const cy = (d: number) => CH_Y1 - (d / yMax) * (CH_Y1 - CH_Y0);
  const pts = [`${cx(0)},${cy(0)}`, ...f.depth.map((d, i) => `${cx(i + 1)},${cy(d)}`)].join(' ');
  const rejectedNow = f.events.filter((e) => e.fate === 'rejected').length;
  const droppedNow = f.events.filter((e) => e.fate === 'dropped-old').length;
  const conH = Math.min(26, 74 / params.consumers - 4);

  const ariaLabel = `Tick ${f.tick}. Queue depth ${f.queue.length}${bounded ? ` of ${params.capacity}` : ''}. Produced ${f.produced}, processed ${f.processed}, rejected ${f.rejected}, dropped ${f.dropped}. ${
    f.backlog ? `Producer blocked with ${f.backlog} item(s).` : ''
  }`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Policy>
            label="When full"
            value={params.policy}
            options={[
              { value: 'unbounded', label: 'Unbounded array' },
              { value: 'block', label: 'Block (await put)' },
              { value: 'reject', label: 'Reject (429)' },
              { value: 'drop-oldest', label: 'Drop oldest' },
            ]}
            onChange={(policy) => setParams((p) => ({ ...p, policy }))}
          />
          <Slider label="Capacity" value={params.capacity} min={3} max={10} onChange={(capacity) => setParams((p) => ({ ...p, capacity }))} />
          <Slider label="Producer rate (items/tick)" value={params.rate} min={1} max={4} onChange={(rate) => setParams((p) => ({ ...p, rate }))} />
          <Slider label="Consumer loops" value={params.consumers} min={1} max={3} onChange={(consumers) => setParams((p) => ({ ...p, consumers }))} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)', borderRadius: 2 }} /> queued item
          <span className="viz-key" style={{ background: 'var(--good)', borderRadius: 2 }} /> being processed
          <span className="viz-key" style={{ background: 'var(--warn)', borderRadius: 2 }} /> producer waiting
          <span className="viz-key" style={{ background: 'var(--bad)', borderRadius: 2 }} /> rejected / dropped
        </>
      }
    >
      <svg viewBox="0 0 600 280" className="viz-svg" role="img" aria-label={ariaLabel}>
        <defs>
          <marker id="bq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>
        {/* producer */}
        <rect x={8} y={Q_Y - 12} width={112} height={56} rx={8} fill={f.backlog ? 'var(--warn-soft)' : 'var(--surface)'} stroke={f.backlog ? 'var(--warn)' : 'var(--border)'} strokeWidth={1.5} />
        <text x={18} y={Q_Y + 4} style={{ fontSize: 12, fontWeight: 800 }}>
          Producer
        </text>
        <text x={18} y={Q_Y + 20} className="viz-label" style={{ fontSize: 10.5 }}>
          {f.tick < BURST_TICKS ? `${params.rate}/tick (burst)` : 'burst over'}
        </text>
        <text x={18} y={Q_Y + 35} style={{ fontSize: 10.5, fontWeight: 700, fill: f.backlog ? 'var(--warn)' : 'var(--muted)' }}>
          {f.backlog ? `blocked, ${f.backlog} in hand` : 'not waiting'}
        </text>
        <line x1={122} y1={Q_Y + 16} x2={qLeft - 4} y2={Q_Y + 16} stroke="var(--muted)" strokeWidth={1.5} markerEnd="url(#bq-arrow)" />
        {(rejectedNow > 0 || droppedNow > 0) && (
          <text x={64} y={Q_Y + 62} textAnchor="middle" style={{ fontSize: 11, fontWeight: 800, fill: 'var(--bad)' }}>
            {rejectedNow ? `✕ ${rejectedNow} × 429` : `✕ ${droppedNow} oldest dropped`}
          </text>
        )}

        {/* queue slots, head (oldest) on the right */}
        <text x={qLeft} y={Q_Y - 18} className="viz-label" style={{ fontSize: 10.5 }}>
          {bounded ? `queue (capacity ${params.capacity})` : 'queue (no limit)'} · tail ← → head
        </text>
        {Array.from({ length: slots }, (_, s) => {
          const x = Q_X1 - (s + 1) * slotW;
          const id = f.queue[s];
          return (
            <g key={s}>
              <rect
                x={x + 1}
                y={Q_Y}
                width={slotW - 2}
                height={32}
                rx={4}
                fill={id !== undefined ? 'var(--accent-soft)' : 'transparent'}
                stroke={id !== undefined ? 'var(--accent)' : 'var(--border)'}
                strokeDasharray={id !== undefined ? undefined : '3 3'}
              />
              {id !== undefined && slotW >= 18 && (
                <text x={x + slotW / 2} y={Q_Y + 20} textAnchor="middle" style={{ fontSize: slotW < 24 ? 8.5 : 10, fontFamily: 'var(--mono)' }}>
                  {id}
                </text>
              )}
            </g>
          );
        })}
        <text x={Q_X1} y={Q_Y + 50} textAnchor="end" style={{ fontSize: 11, fontWeight: 700, fill: f.queue.length > params.capacity ? 'var(--bad)' : 'var(--text)' }}>
          depth {f.queue.length} · ≈{f.queue.length * ITEM_KB} KB
        </text>
        <line x1={Q_X1 + 2} y1={Q_Y + 16} x2={488} y2={Q_Y + 16} stroke="var(--muted)" strokeWidth={1.5} markerEnd="url(#bq-arrow)" />

        {/* consumers */}
        {f.working.map((w, k) => {
          const y = Q_Y - 12 + k * (conH + 4);
          return (
            <g key={k}>
              <rect x={492} y={y} width={100} height={conH} rx={6} fill={w !== null ? 'var(--good-soft)' : 'var(--surface)'} stroke={w !== null ? 'var(--good)' : 'var(--border)'} />
              <text x={500} y={y + conH / 2 + 4} style={{ fontSize: 10.5 }}>
                loop {k + 1}: {w !== null ? `#${w}` : 'idle'}
              </text>
            </g>
          );
        })}

        {/* depth chart */}
        <rect x={cx(0)} y={CH_Y0} width={cx(Math.min(BURST_TICKS, tMax)) - cx(0)} height={CH_Y1 - CH_Y0} fill="var(--warn-soft)" opacity={0.5} />
        <text x={cx(0) + 4} y={CH_Y0 + 12} className="viz-label" style={{ fontSize: 10 }}>
          burst
        </text>
        <line x1={CH_X0} x2={CH_X1} y1={CH_Y1} y2={CH_Y1} stroke="var(--border)" />
        <line x1={CH_X0} x2={CH_X0} y1={CH_Y0} y2={CH_Y1} stroke="var(--border)" />
        <text x={CH_X0 - 6} y={cy(yMax) + 4} textAnchor="end" className="viz-label" style={{ fontSize: 10 }}>
          {yMax}
        </text>
        <text x={CH_X0 - 6} y={CH_Y1 + 4} textAnchor="end" className="viz-label" style={{ fontSize: 10 }}>
          0
        </text>
        {bounded && (
          <>
            <line x1={CH_X0} x2={CH_X1} y1={cy(params.capacity)} y2={cy(params.capacity)} stroke="var(--bad)" strokeDasharray="5 4" />
            <text x={CH_X1} y={cy(params.capacity) - 4} textAnchor="end" style={{ fontSize: 10, fill: 'var(--bad)' }}>
              capacity
            </text>
          </>
        )}
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={2.2} strokeLinejoin="round" />
        <circle cx={cx(f.tick)} cy={cy(f.tick ? f.depth[f.tick - 1] : 0)} r={4} fill="var(--accent)" />
        <text x={CH_X1} y={CH_Y1 + 16} textAnchor="end" className="viz-label" style={{ fontSize: 10 }}>
          ticks →
        </text>
        <text x={CH_X0} y={CH_Y1 + 16} className="viz-label" style={{ fontSize: 10 }}>
          queue depth over time
        </text>

        <text x={8} y={274} style={{ fontSize: 11.5 }}>
          produced <tspan fontWeight={800}>{f.produced}</tspan> · processed <tspan fontWeight={800}>{f.processed}</tspan> · 429s{' '}
          <tspan fontWeight={800} style={{ fill: f.rejected ? 'var(--bad)' : undefined }}>
            {f.rejected}
          </tspan>{' '}
          · dropped{' '}
          <tspan fontWeight={800} style={{ fill: f.dropped ? 'var(--bad)' : undefined }}>
            {f.dropped}
          </tspan>{' '}
          · producer blocked <tspan fontWeight={800}>{f.blockedTicks}</tspan> tick(s)
        </text>
      </svg>
    </VizFrame>
  );
}
