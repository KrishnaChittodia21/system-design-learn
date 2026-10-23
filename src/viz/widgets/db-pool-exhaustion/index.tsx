import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import {
  ACQUIRE_LABELS,
  ACQUIRE_TIMEOUT,
  GATEWAY_TIMEOUT,
  INCIDENT_FROM,
  INCIDENT_LABELS,
  INCIDENT_TO,
  TICKS,
  TICK_MS,
  simulate,
  type AcquireTimeout,
  type Incident,
  type Params,
} from './sim';

const X0 = 40;
const X1 = 592;

export default function DbPoolExhaustionViz() {
  const [params, setParams] = useState<Params>({ pool: 8, incident: 'slow', acquire: 'none' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const final = frames[frames.length - 1];
  const now = Math.max(0, f.t);
  const inUse = f.slots.filter((s) => s.req !== null).length;
  const zombies = f.slots.filter((s) => s.zombie).length;

  // queue dots
  const perRow = 46;
  const qColor = (waited: number) =>
    waited >= GATEWAY_TIMEOUT ? 'var(--bad)' : params.acquire === 'fast' && waited >= ACQUIRE_TIMEOUT - 1 ? 'var(--warn)' : waited >= 5 ? 'var(--warn)' : 'var(--blue)';

  // pool slots
  const slotGap = 4;
  const slotW = Math.min(52, (X1 - X0 - slotGap * (params.pool - 1)) / params.pool);
  const slotY = 96;
  const slotH = 40;

  // history chart
  const cTop = 178;
  const cBot = 258;
  const yMax = Math.max(params.pool + 2, ...final.history.map((h) => h.inUse + h.queue), ...final.history.map((h) => h.demand));
  const cw = (X1 - X0) / TICKS;
  const y = (v: number) => cBot - (v / yMax) * (cBot - cTop);

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Slider label="Pool size (max)" value={params.pool} min={4} max={24} onChange={(v) => setParams((p) => ({ ...p, pool: v }))} format={(v) => `${v} connections`} />
          <Choice<Incident>
            label="Incident"
            value={params.incident}
            options={(Object.keys(INCIDENT_LABELS) as Incident[]).map((k) => ({ value: k, label: INCIDENT_LABELS[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, incident: v }))}
          />
          <Choice<AcquireTimeout>
            label="Acquire timeout"
            value={params.acquire}
            options={(Object.keys(ACQUIRE_LABELS) as AcquireTimeout[]).map((k) => ({ value: k, label: ACQUIRE_LABELS[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, acquire: v }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--blue)' }} /> waiting / in use
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> waiting long
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> past the 1 s gateway timeout (user already got 504)
          <span className="viz-key" style={{ background: 'var(--good)' }} /> succeeded
        </>
      }
    >
      <svg
        viewBox="0 0 600 302"
        className="viz-svg"
        role="img"
        aria-label={`${f.t < 0 ? 'Before start' : `t=${f.t * TICK_MS} ms`}. ${inUse} of ${params.pool} connections in use, ${f.queue.length} requests waiting. ${f.ok} succeeded, ${f.failFast} failed fast, ${f.gateway} gateway timeouts, ${f.wasted} wasted queries.`}
      >
        <text x={8} y={18} className="viz-label">
          wait queue (FIFO) · {f.queue.length} waiting
        </text>
        <text x={592} y={18} textAnchor="end" style={{ fontSize: 12, fontWeight: 700, fill: f.t >= INCIDENT_FROM && f.t < INCIDENT_TO ? 'var(--bad)' : 'var(--text-2)' }}>
          {f.t < 0 ? 'before start' : `t = ${f.t * TICK_MS} ms · ${f.t >= INCIDENT_FROM && f.t < INCIDENT_TO ? INCIDENT_LABELS[params.incident] : f.t < INCIDENT_FROM ? 'normal' : 'incident over'}`}
        </text>
        {f.queue.length === 0 && (
          <text x={8} y={46} className="viz-label">
            empty: every request gets a connection immediately
          </text>
        )}
        {f.queue.map((w, k) => {
          const waited = now - w.arrived;
          return (
            <circle
              key={w.id}
              cx={14 + (k % perRow) * 12.6}
              cy={36 + Math.floor(k / perRow) * 14}
              r={5}
              fill={qColor(waited)}
              className="viz-dot"
            >
              <title>{`request #${w.id}, waiting ${waited * TICK_MS} ms`}</title>
            </circle>
          );
        })}

        <text x={8} y={slotY - 12} className="viz-label">
          connection pool · {inUse}/{params.pool} in use{zombies ? ` · ${zombies} working for clients that left` : ''}
        </text>
        {f.slots.map((s, k) => {
          const x = X0 + k * (slotW + slotGap);
          const busy = s.req !== null;
          const col = s.zombie ? 'var(--bad)' : 'var(--blue)';
          return (
            <g key={k}>
              <rect
                x={x}
                y={slotY}
                width={slotW}
                height={slotH}
                rx={6}
                fill={busy ? (s.zombie ? 'var(--bad-soft)' : 'var(--blue-s)') : 'var(--surface)'}
                stroke={busy ? col : 'var(--border-strong)'}
                strokeWidth={busy ? 2 : 1}
                strokeDasharray={busy ? undefined : '4 3'}
              />
              {busy && <rect x={x + 3} y={slotY + slotH - 7} width={Math.max(0, (slotW - 6) * (s.left / Math.max(1, s.hold)))} height={4} rx={2} fill={col} />}
              {busy && slotW >= 26 && (
                <text x={x + slotW / 2} y={slotY + 21} textAnchor="middle" style={{ fontSize: 10, fontWeight: 700 }}>
                  #{s.req}
                </text>
              )}
            </g>
          );
        })}
        <text x={8} y={slotY + 25} className="viz-label">
          DB
        </text>

        {/* history chart */}
        <text x={8} y={cTop - 8} className="viz-label">
          per tick: connections in use + requests waiting
        </text>
        <rect x={X0 + INCIDENT_FROM * cw} y={cTop} width={(INCIDENT_TO - INCIDENT_FROM) * cw} height={cBot - cTop} fill="var(--bad-soft)" />
        <line x1={X0} y1={cBot} x2={X1} y2={cBot} stroke="var(--border)" />
        {f.history.map((h) => (
          <g key={h.t}>
            <rect x={X0 + h.t * cw + 1} y={y(h.inUse)} width={cw - 2} height={cBot - y(h.inUse)} fill="var(--blue)" opacity={0.8} />
            <rect x={X0 + h.t * cw + 1} y={y(h.inUse + h.queue)} width={cw - 2} height={y(h.inUse) - y(h.inUse + h.queue)} fill="var(--warn)" opacity={0.85} />
          </g>
        ))}
        <line x1={X0} y1={y(params.pool)} x2={X1} y2={y(params.pool)} stroke="var(--text)" strokeDasharray="5 4" />
        <text x={X0 - 4} y={y(params.pool) + 4} textAnchor="end" style={{ fontSize: 10, fontWeight: 700 }}>
          {params.pool}
        </text>
        {final.history.map((h, k) =>
          k === 0 ? null : (
            <line
              key={h.t}
              x1={X0 + (k - 1) * cw + cw / 2}
              y1={y(final.history[k - 1].demand)}
              x2={X0 + k * cw + cw / 2}
              y2={y(h.demand)}
              stroke="var(--bad)"
              strokeWidth={1.5}
              strokeDasharray="2 3"
            />
          ),
        )}
        <text x={X1} y={cTop + 10} textAnchor="end" style={{ fontSize: 10, fill: 'var(--bad)' }}>
          ··· Little's Law demand λ×W
        </text>
        {f.t >= 0 && <rect x={X0 + f.t * cw} y={cTop} width={cw} height={cBot - cTop} fill="none" stroke="var(--text-2)" />}
        <text x={X0} y={cBot + 14} className="viz-label" style={{ fontSize: 10 }}>
          0 ms
        </text>
        <text x={X1} y={cBot + 14} textAnchor="end" className="viz-label" style={{ fontSize: 10 }}>
          {TICKS * TICK_MS} ms
        </text>

        <text x={8} y={294} className="viz-label">
          succeeded <tspan style={{ fontWeight: 700, fill: 'var(--good)' }}>{f.ok}</tspan> · failed fast 503{' '}
          <tspan style={{ fontWeight: 700, fill: f.failFast ? 'var(--warn)' : 'var(--text)' }}>{f.failFast}</tspan> · gateway 504{' '}
          <tspan style={{ fontWeight: 700, fill: f.gateway ? 'var(--bad)' : 'var(--text)' }}>{f.gateway}</tspan> · wasted queries{' '}
          <tspan style={{ fontWeight: 700, fill: f.wasted ? 'var(--bad)' : 'var(--text)' }}>{f.wasted}</tspan> · avg wait {f.avgWaitMs} ms
        </text>
      </svg>
    </VizFrame>
  );
}
