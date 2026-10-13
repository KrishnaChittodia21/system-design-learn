import { useState } from 'react';
import { Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { ALGOS, DEFAULT_PARAMS, TICKS, TICK_MS, W, simulate, type AlgoId, type Params } from './sim';

const NAMES: Record<AlgoId, string> = {
  token: 'Token bucket',
  fixed: 'Fixed window',
  sliding: 'Sliding window',
};

const X0 = 160;
const COL = (592 - X0) / TICKS;
const TOP = 52;
const LANE_H = 92;
const DOT_STEP = 6.4;

export default function RateLimiterViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = (k: keyof Params) => (v: number) => setParams((p) => ({ ...p, [k]: v }));
  const colX = (t: number) => X0 + t * COL;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Limit per second / bucket size B" value={params.limit} min={3} max={8} onChange={set('limit')} />
          <Slider label="Token refill R" value={params.refill} min={1} max={10} onChange={set('refill')} format={(v) => `${v}/s`} />
          <Slider label="Burst size" value={params.burst} min={2} max={10} onChange={set('burst')} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)' }} /> allowed
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> rejected (429)
          <span>dashed lines = 1 s window boundaries · 1 tick = {TICK_MS} ms</span>
        </>
      }
    >
      <svg
        viewBox="0 0 600 340"
        className="viz-svg"
        role="img"
        aria-label={`Tick ${Math.max(0, f.tick)}: ${ALGOS.map((a) => `${NAMES[a]} allowed ${f.algos[a].allowedTotal}`).join(', ')}`}
      >
        {/* current tick highlight */}
        {f.tick >= 0 && f.tick < TICKS && (
          <rect x={colX(f.tick)} y={8} width={COL} height={TOP - 8 + LANE_H * 3} rx={3} fill="var(--accent-soft)" />
        )}
        {/* arrivals row */}
        <text x={8} y={24} className="viz-label">
          arrivals per tick
        </text>
        {f.arrivals.map((n, t) =>
          n > 0 ? (
            <g key={t} opacity={t <= f.tick ? 1 : 0.4}>
              <rect x={colX(t) + 3} y={30} width={COL - 6} height={14} rx={3} fill="var(--accent)" opacity={0.25} />
              <text x={colX(t) + COL / 2} y={41} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700 }}>
                {n}
              </text>
            </g>
          ) : null,
        )}
        {/* window boundaries */}
        {Array.from({ length: TICKS / W + 1 }, (_, w) => (
          <g key={w}>
            <line x1={colX(w * W)} x2={colX(w * W)} y1={10} y2={TOP + LANE_H * 3} stroke="var(--muted)" strokeDasharray="4 3" />
            {w < TICKS / W && (
              <text x={colX(w * W) + 4} y={18} className="viz-label" style={{ fontSize: 10 }}>
                window {w}
              </text>
            )}
          </g>
        ))}
        {/* lanes */}
        {ALGOS.map((id, li) => {
          const a = f.algos[id];
          const y0 = TOP + li * LANE_H;
          const base = y0 + LANE_H - 8;
          const over = a.maxInWindow > params.limit;
          return (
            <g key={id}>
              <line x1={0} x2={600} y1={y0} y2={y0} stroke="var(--border)" />
              <text x={8} y={y0 + 18} className="viz-node-label" style={{ fontSize: 12.5 }}>
                {NAMES[id]}
              </text>
              <text x={8} y={y0 + 36} className="viz-label" style={{ fontSize: 10.5, fontFamily: 'var(--mono)' }}>
                {a.state}
              </text>
              <rect x={8} y={y0 + 44} width={140} height={8} rx={4} fill="var(--surface-2)" />
              <rect
                x={8}
                y={y0 + 44}
                width={140 * Math.max(0, Math.min(1, a.gauge))}
                height={8}
                rx={4}
                fill={id === 'token' ? 'var(--good)' : a.gauge >= 1 ? 'var(--bad)' : 'var(--warn)'}
                style={{ transition: 'width 0.3s ease' }}
              />
              <text x={8} y={y0 + 68} className="viz-label" style={{ fontSize: 10.5 }}>
                allowed {a.allowedTotal} · max in 1 s{' '}
                <tspan style={{ fill: over ? 'var(--bad)' : 'var(--text-2)', fontWeight: over ? 700 : 400 }}>{a.maxInWindow}</tspan>
              </text>
              {a.history.map((r, t) => {
                const cx = colX(t) + COL / 2;
                const dots = [];
                for (let k = 0; k < r.allowed + r.rejected; k++) {
                  dots.push(
                    <circle
                      key={k}
                      cx={cx}
                      cy={base - k * DOT_STEP}
                      r={2.7}
                      fill={k < r.allowed ? 'var(--good)' : 'var(--bad)'}
                    />,
                  );
                }
                return <g key={t}>{dots}</g>;
              })}
            </g>
          );
        })}
      </svg>
    </VizFrame>
  );
}
