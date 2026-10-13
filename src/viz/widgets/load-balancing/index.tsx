import { useState } from 'react';
import { Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { ALGOS, DEFAULT_PARAMS, FAST_TICKS, NAME, SLOW, TICKS, TICK_MS, WORKERS, simulate, type Params } from './sim';

const PANEL_W = 196;
const ROW_H = 28;
const ROWS_Y = 46;
const CELL = 9;
const MAX_CELLS = 7;

export default function LoadBalancingViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const set = (k: keyof Params) => (v: number) => setParams((p) => ({ ...p, [k]: v }));
  const metricsY = ROWS_Y + params.servers * ROW_H + 14;
  const p99Max = Math.max(params.slowTicks * TICK_MS, ...ALGOS.map((a) => f.algos[a].p99));

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Servers" value={params.servers} min={4} max={6} onChange={set('servers')} />
          <Slider
            label={`Slow server (S${SLOW + 1}) latency`}
            value={params.slowTicks}
            min={4}
            max={20}
            step={2}
            onChange={set('slowTicks')}
            format={(v) => `${v * TICK_MS} ms`}
          />
          <Slider
            label="Request rate"
            value={params.rate}
            min={1}
            max={4}
            step={0.5}
            onChange={set('rate')}
            format={(v) => `${v}/tick (${Math.round((v * 1000) / TICK_MS)} req/s)`}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)', borderRadius: 2 }} /> running (≤ {WORKERS} workers)
          <span className="viz-key" style={{ background: 'var(--warn)', borderRadius: 2 }} /> queued
          <span className="viz-key ring" /> P2C’s two sampled servers
          <span>
            fast servers {FAST_TICKS * TICK_MS} ms · tick {f.tick < 0 ? '–' : Math.min(f.tick, TICKS - 1)} / {TICKS - 1}
          </span>
        </>
      }
    >
      <svg
        viewBox={`0 0 600 ${metricsY + 92}`}
        className="viz-svg"
        role="img"
        aria-label={`p99 latency: ${ALGOS.map((a) => `${NAME[a]} ${f.algos[a].p99} ms`).join(', ')}`}
      >
        {ALGOS.map((id, k) => {
          const a = f.algos[id];
          const x0 = 4 + k * (PANEL_W + 2);
          const pair = id === 'p2c' && f.tick >= 0 && f.tick < TICKS ? a.lastPair : undefined;
          return (
            <g key={id}>
              <rect x={x0} y={4} width={PANEL_W - 4} height={metricsY + 84} rx={8} fill="none" stroke="var(--border)" />
              <text x={x0 + 10} y={24} className="viz-node-label">
                {NAME[id]}
              </text>
              <text x={x0 + PANEL_W - 14} y={24} textAnchor="end" className="viz-label" style={{ fontSize: 10 }}>
                sent
              </text>
              {a.servers.map((s, i) => {
                const y = ROWS_Y + i * ROW_H;
                const slow = i === SLOW;
                const total = s.running + s.queued;
                const sampled = pair && (pair[0] === i || pair[1] === i);
                return (
                  <g key={i}>
                    {sampled && <rect x={x0 + 4} y={y - 4} width={PANEL_W - 12} height={ROW_H - 4} rx={5} fill="none" stroke="var(--text)" strokeWidth={1.5} />}
                    <text x={x0 + 10} y={y + 13} style={{ fontSize: 11.5, fontWeight: 700, fill: slow ? 'var(--bad)' : 'var(--text)' }}>
                      S{i + 1}
                    </text>
                    {slow && (
                      <text x={x0 + 10} y={y + 23} style={{ fontSize: 8.5, fontWeight: 700, fill: 'var(--bad)' }}>
                        SLOW
                      </text>
                    )}
                    {Array.from({ length: Math.min(total, MAX_CELLS) }, (_, c) => (
                      <rect
                        key={c}
                        x={x0 + 66 + c * (CELL + 1.5)}
                        y={y + 2}
                        width={CELL}
                        height={14}
                        rx={2}
                        fill={c < s.running ? 'var(--accent)' : 'var(--warn)'}
                      />
                    ))}
                    {total > MAX_CELLS && (
                      <text x={x0 + 66 + MAX_CELLS * (CELL + 1.5) + 2} y={y + 13} style={{ fontSize: 10, fontWeight: 700, fill: 'var(--warn)' }}>
                        +{total - MAX_CELLS}
                      </text>
                    )}
                    {s.justSent > 0 && f.tick >= 0 && f.tick < TICKS && (
                      <text x={x0 + 58} y={y + 13} textAnchor="end" className="viz-label" style={{ fontSize: 9.5 }}>
                        +{s.justSent}
                      </text>
                    )}
                    <text x={x0 + PANEL_W - 14} y={y + 13} textAnchor="end" className="viz-label" style={{ fontSize: 10.5 }}>
                      {s.sent}
                    </text>
                  </g>
                );
              })}
              {/* metrics */}
              {[
                { label: 'p50', v: a.p50 },
                { label: 'p99', v: a.p99 },
              ].map((m, mi) => {
                const y = metricsY + mi * 22;
                const bad = m.v > params.slowTicks * TICK_MS;
                return (
                  <g key={m.label}>
                    <text x={x0 + 10} y={y + 11} className="viz-label">
                      {m.label}
                    </text>
                    <rect x={x0 + 38} y={y + 2} width={96} height={10} rx={3} fill="var(--surface-2)" />
                    <rect
                      x={x0 + 38}
                      y={y + 2}
                      width={(96 * m.v) / p99Max}
                      height={10}
                      rx={3}
                      fill={bad ? 'var(--bad)' : 'var(--good)'}
                      style={{ transition: 'width 0.3s ease' }}
                    />
                    <text x={x0 + 140} y={y + 11} style={{ fontSize: 11, fontWeight: 600 }}>
                      {m.v} ms
                    </text>
                  </g>
                );
              })}
              <text x={x0 + 10} y={metricsY + 58} className="viz-label" style={{ fontSize: 11 }}>
                to S{SLOW + 1}: {Math.round(a.slowShare * 100)}% · done {a.completed}
              </text>
              <text x={x0 + 10} y={metricsY + 74} className="viz-label" style={{ fontSize: 10 }}>
                fair share {Math.round(100 / params.servers)}%
              </text>
            </g>
          );
        })}
      </svg>
    </VizFrame>
  );
}
