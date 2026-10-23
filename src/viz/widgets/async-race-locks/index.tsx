import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { simulate, type Fix, type Params, type Scenario, type TaskStatus } from './sim';

const COL_X = [8, 306];
const COL_W = 286;
const OP_Y = 62;
const OP_H = 23;
const OP_GAP = 4;

const STATUS: Record<TaskStatus, { label: string; color: string }> = {
  ready: { label: 'ready', color: 'var(--muted)' },
  running: { label: 'on the event loop', color: 'var(--accent)' },
  awaiting: { label: 'awaiting', color: 'var(--warn)' },
  blocked: { label: 'blocked on lock', color: 'var(--bad)' },
  done: { label: 'done', color: 'var(--good)' },
  error: { label: 'threw', color: 'var(--bad)' },
};
const KIND_COLOR = { check: 'var(--muted)', write: 'var(--good)', await: 'var(--warn)', lock: 'var(--accent)', unlock: 'var(--accent)' };

const FIXES: Record<Scenario, { value: Fix; label: string }[]> = {
  debit: [
    { value: 'none', label: 'Check, await, write (bug)' },
    { value: 'sync', label: 'No await in between' },
    { value: 'mutex', label: 'Per-wallet mutex' },
  ],
  transfer: [
    { value: 'unordered', label: 'Lock source first' },
    { value: 'ordered', label: 'Lock lower id first' },
  ],
};

export default function AsyncRaceLocksViz() {
  const [params, setParams] = useState<Params>({ scenario: 'debit', fix: 'none' });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const maxOps = Math.max(...f.tasks.map((t) => t.ops.length));
  const stateY = OP_Y + maxOps * (OP_H + OP_GAP) + 18;
  const H = stateY + 78;
  const storeEntries = Object.entries(f.store);
  const lockEntries = Object.entries(f.locks);

  const ariaLabel = `t=${f.now}. ${f.tasks.map((t) => `${t.name} ${t.title}: ${STATUS[t.status].label}, ${t.note}`).join('. ')}. State: ${storeEntries
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')}${lockEntries.length ? `. Locks: ${lockEntries.map(([k, l]) => `${k} held by ${l.owner ?? 'nobody'}${l.waiters.length ? `, waiting ${l.waiters.join(',')}` : ''}`).join('; ')}` : ''}.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Scenario>
            label="Scenario"
            value={params.scenario}
            options={[
              { value: 'debit', label: 'Double-tap debit' },
              { value: 'transfer', label: 'Crossed transfers' },
            ]}
            onChange={(scenario) => setParams({ scenario, fix: FIXES[scenario][0].value })}
          />
          <Choice<Fix> label="Code" value={params.fix} options={FIXES[params.scenario]} onChange={(fix) => setParams((p) => ({ ...p, fix }))} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--muted)', borderRadius: 2 }} /> check
          <span className="viz-key" style={{ background: 'var(--warn)', borderRadius: 2 }} /> await (yields)
          <span className="viz-key" style={{ background: 'var(--good)', borderRadius: 2 }} /> write
          <span className="viz-key" style={{ background: 'var(--accent)', borderRadius: 2 }} /> lock / release
          <span className="viz-key ring" style={{ borderColor: 'var(--accent)', borderRadius: 2 }} /> just ran
        </>
      }
    >
      <svg viewBox={`0 0 600 ${H}`} className="viz-svg" role="img" aria-label={ariaLabel}>
        <text x={300} y={14} textAnchor="middle" className="viz-label">
          one event loop · t = {f.now} · running: {f.cpu ?? 'nobody (waiting on timers)'}
        </text>
        {f.tasks.map((t, ti) => {
          const x = COL_X[ti];
          const st = STATUS[t.status];
          return (
            <g key={t.name}>
              <rect
                x={x}
                y={22}
                width={COL_W}
                height={OP_Y - 26 + t.ops.length * (OP_H + OP_GAP) + 4}
                rx={10}
                fill="var(--surface)"
                stroke={f.cpu === t.name ? 'var(--accent)' : 'var(--border)'}
                strokeWidth={f.cpu === t.name ? 2 : 1}
              />
              <text x={x + 10} y={40} style={{ fontSize: 12.5, fontWeight: 800 }}>
                {t.name}{' '}
                <tspan style={{ fontFamily: 'var(--mono)', fontWeight: 500, fontSize: 11.5 }}>{t.title}</tspan>
              </text>
              <text x={x + 10} y={55} style={{ fontSize: 10.5, fontWeight: 700, fill: st.color }}>
                {st.label}
                <tspan className="viz-label" style={{ fontWeight: 400 }}>
                  {' '}
                  · {t.note}
                </tspan>
              </text>
              {t.ops.map((op, oi) => {
                const y = OP_Y + oi * (OP_H + OP_GAP);
                const ran = oi < t.pc;
                const isLast = f.last?.[0] === ti && f.last?.[1] === oi;
                const isNext = oi === t.pc && t.status !== 'done' && t.status !== 'error';
                const failedHere = oi === t.pc && t.status === 'error';
                const blockedHere = isNext && t.status === 'blocked';
                return (
                  <g key={oi}>
                    <rect
                      x={x + 8}
                      y={y}
                      width={COL_W - 16}
                      height={OP_H}
                      rx={5}
                      fill={failedHere ? 'var(--bad-soft)' : blockedHere ? 'var(--warn-soft)' : ran ? 'var(--surface-2)' : 'transparent'}
                      stroke={isLast ? 'var(--accent)' : failedHere ? 'var(--bad)' : isNext ? 'var(--muted)' : 'var(--border)'}
                      strokeWidth={isLast ? 2.4 : 1}
                      strokeDasharray={isNext && !isLast ? '4 3' : undefined}
                    />
                    <rect x={x + 8} y={y} width={5} height={OP_H} rx={2} fill={KIND_COLOR[op.kind]} />
                    <text
                      x={x + 20}
                      y={y + 15.5}
                      style={{ fontSize: 11, fontFamily: 'var(--mono)', fill: ran || isNext ? 'var(--text)' : 'var(--muted)' }}
                    >
                      {op.label}
                    </text>
                    {ran && (
                      <text x={x + COL_W - 14} y={y + 15.5} textAnchor="end" style={{ fontSize: 11, fill: 'var(--good)' }}>
                        ✓
                      </text>
                    )}
                    {failedHere && (
                      <text x={x + COL_W - 14} y={y + 15.5} textAnchor="end" style={{ fontSize: 11, fontWeight: 800, fill: 'var(--bad)' }}>
                        ✕
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* shared state */}
        <text x={8} y={stateY} className="viz-label">
          shared in-memory state
        </text>
        {storeEntries.map(([k, v], i) => (
          <g key={k}>
            <rect
              x={8 + i * 118}
              y={stateY + 8}
              width={108}
              height={44}
              rx={8}
              fill={v < 0 ? 'var(--bad-soft)' : 'var(--surface-2)'}
              stroke={v < 0 ? 'var(--bad)' : 'var(--border)'}
              strokeWidth={v < 0 ? 2 : 1}
            />
            <text x={18 + i * 118} y={stateY + 26} className="viz-label" style={{ fontSize: 10.5 }}>
              wallet {k}
            </text>
            <text x={18 + i * 118} y={stateY + 44} style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--mono)', fill: v < 0 ? 'var(--bad)' : 'var(--text)' }}>
              {v < 0 ? `−₹${-v}` : `₹${v}`}
            </text>
          </g>
        ))}
        {lockEntries.map(([k, l], i) => {
          const x = 8 + storeEntries.length * 118 + 12 + i * 134;
          return (
            <g key={k}>
              <rect
                x={x}
                y={stateY + 8}
                width={124}
                height={44}
                rx={8}
                fill={l.owner ? 'var(--accent-soft)' : 'var(--surface-2)'}
                stroke={l.waiters.length ? 'var(--warn)' : l.owner ? 'var(--accent)' : 'var(--border)'}
                strokeWidth={1.5}
              />
              <text x={x + 10} y={stateY + 26} className="viz-label" style={{ fontSize: 10.5 }}>
                mutex({k})
              </text>
              <text x={x + 10} y={stateY + 44} style={{ fontSize: 11.5, fontWeight: 700 }}>
                {l.owner ? `held by ${l.owner}` : 'free'}
                {l.waiters.length ? <tspan style={{ fill: 'var(--warn)' }}>{` · ${l.waiters.join(',')} waits`}</tspan> : null}
              </text>
            </g>
          );
        })}
        {f.outcome !== 'running' && (
          <text
            x={592}
            y={stateY}
            textAnchor="end"
            style={{ fontSize: 12, fontWeight: 800, fill: f.outcome === 'bug' ? 'var(--bad)' : f.outcome === 'error' ? 'var(--warn)' : 'var(--good)' }}
          >
            {f.outcome === 'bug' ? 'invariant broken' : f.outcome === 'error' ? 'timeout surfaced' : 'invariant holds'}
          </text>
        )}
      </svg>
    </VizFrame>
  );
}
