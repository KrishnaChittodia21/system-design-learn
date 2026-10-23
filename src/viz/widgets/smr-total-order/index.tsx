import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { CLAIMS, LEADER, MODE_LABELS, NODES, simulate, type ClaimId, type Mode, type Msg, type NodeId, type Params } from './sim';

const CLAIM_COLOR: Record<ClaimId, string> = { m1: 'var(--blue)', m2: 'var(--mag)' };
const LANE: Record<NodeId, number> = { R1: 52, R2: 132, R3: 212 };
const X0 = 44;
const X1 = 440;

export default function SmrTotalOrderViz() {
  const [params, setParams] = useState<Params>({ mode: 'none', crash: false });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const final = frames[frames.length - 1];
  const T = Math.max(8, final.t + 1);
  const x = (t: number) => X0 + (t / T) * (X1 - X0);
  const now = f.t;

  const msgColor = (m: Msg) => (m.kind === 'ack' ? 'var(--control)' : CLAIM_COLOR[m.claim!]);

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Mode>
            label="Ordering"
            value={params.mode}
            options={(Object.keys(MODE_LABELS) as Mode[]).map((k) => ({ value: k, label: MODE_LABELS[k] }))}
            onChange={(v) => setParams((p) => ({ ...p, mode: v }))}
          />
          <Choice<'up' | 'down'>
            label="R2"
            value={params.crash ? 'down' : 'up'}
            options={[
              { value: 'up', label: 'up' },
              { value: 'down', label: 'crashed' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, crash: v === 'down' }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: CLAIM_COLOR.m1 }} /> u1's claim
          <span className="viz-key" style={{ background: CLAIM_COLOR.m2 }} /> u2's claim
          {params.mode === 'lamport' && (
            <>
              <span className="viz-key" style={{ background: 'var(--control)' }} /> ack (carries a timestamp)
            </>
          )}
          <span>● issued · ■ applied (filled = won the name)</span>
        </>
      }
    >
      <svg
        viewBox="0 0 600 292"
        className="viz-svg"
        role="img"
        aria-label={`${now < 0 ? 'Before start' : `t=${now}`}. ${NODES.map((n) => `${n}: ${f.nodes[n].up ? (f.nodes[n].owner ? `ana owned by ${f.nodes[n].owner}` : 'no owner yet') : 'down'}`).join('; ')}. ${f.diverged ? 'Replicas disagree.' : ''}${f.stuck ? ' Stuck.' : ''}`}
      >
        <defs>
          {(['m1', 'm2', 'ack'] as const).map((k) => (
            <marker key={k} id={`smr-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={k === 'ack' ? 'var(--control)' : CLAIM_COLOR[k]} />
            </marker>
          ))}
        </defs>
        <text x={X0} y={16} className="viz-label">
          space–time diagram (time →)
        </text>
        <text x={456} y={16} className="viz-label">
          replica state
        </text>

        {/* lanes and time ticks */}
        {Array.from({ length: T + 1 }, (_, t) => (
          <text key={t} x={x(t)} y={252} textAnchor="middle" className="viz-label" style={{ fontSize: 10 }}>
            {t}
          </text>
        ))}
        {now >= 0 && <line x1={x(now)} y1={30} x2={x(now)} y2={238} stroke="var(--text-2)" strokeDasharray="3 3" />}
        {NODES.map((n) => (
          <g key={n} opacity={f.nodes[n].up ? 1 : 0.45}>
            <text x={8} y={LANE[n] + 4} style={{ fontSize: 13, fontWeight: 800 }}>
              {n}
            </text>
            <line x1={X0} y1={LANE[n]} x2={X1} y2={LANE[n]} stroke="var(--border-strong)" strokeWidth={2} strokeDasharray={f.nodes[n].up ? undefined : '6 5'} />
            {params.mode === 'tob' && n === LEADER && (
              <text x={8} y={LANE[n] + 18} className="viz-label" style={{ fontSize: 9.5 }}>
                sequencer
              </text>
            )}
            {!f.nodes[n].up && (
              <text x={8} y={LANE[n] + 18} style={{ fontSize: 9.5, fontWeight: 700, fill: 'var(--bad)' }}>
                down
              </text>
            )}
          </g>
        ))}

        {/* messages */}
        {f.msgs.map((m) => {
          const end = Math.min(m.arriveT, now);
          const frac = (end - m.sendT) / (m.arriveT - m.sendT);
          const x1 = x(m.sendT);
          const y1 = LANE[m.from];
          const x2 = x(end);
          const y2 = y1 + (LANE[m.to] - y1) * frac;
          const col = msgColor(m);
          const arrived = m.arriveT <= now;
          return (
            <g key={m.id}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={m.dropped ? 'var(--bad)' : col}
                strokeWidth={m.kind === 'ack' ? 1.2 : 2}
                strokeDasharray={m.dropped ? '4 3' : undefined}
                markerEnd={arrived && !m.dropped ? `url(#smr-arrow-${m.kind === 'ack' ? 'ack' : m.claim})` : undefined}
              />
              {arrived && m.dropped && (
                <text x={x2} y={y2 + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 800, fill: 'var(--bad)' }}>
                  ×
                </text>
              )}
              {m.kind === 'seq' && frac > 0.4 && (
                <text x={(x1 + x2) / 2 + 6} y={(y1 + y2) / 2} style={{ fontSize: 10, fontWeight: 700, fill: col }}>
                  #{m.seq}
                </text>
              )}
              {m.kind === 'ack' && frac > 0.5 && params.mode === 'lamport' && (
                <text x={(x1 + x2) / 2 + 4} y={(y1 + y2) / 2 - 2} style={{ fontSize: 9, fill: 'var(--muted)' }}>
                  {m.ts}
                </text>
              )}
            </g>
          );
        })}

        {/* events */}
        {f.events.map((e, k) => {
          const cx = x(e.t);
          const cy = LANE[e.node];
          const col = CLAIM_COLOR[e.claim];
          if (e.kind === 'issue')
            return (
              <g key={k}>
                <circle cx={cx} cy={cy} r={7} fill={col} />
                <text x={cx} y={cy - 12} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 800, fill: col }}>
                  {CLAIMS[e.claim].user}
                  {e.ts !== undefined ? ` @${e.ts}.${e.node.slice(1)}` : ''}
                </text>
              </g>
            );
          const sameSpot = f.events.filter((o) => o.kind === 'apply' && o.node === e.node && o.t === e.t);
          const off = sameSpot.indexOf(e) * 15;
          return (
            <g key={k}>
              <rect x={cx - 6 + off} y={cy + 8} width={12} height={12} rx={2} fill={e.won ? col : 'var(--surface)'} stroke={col} strokeWidth={2} />
            </g>
          );
        })}

        {/* replica state */}
        {NODES.map((n) => {
          const v = f.nodes[n];
          const y0 = LANE[n] - 30;
          const owners = NODES.filter((o) => f.nodes[o].up && f.nodes[o].owner).map((o) => f.nodes[o].owner);
          const disagree = f.diverged && v.owner !== null && owners.some((o) => o !== v.owner);
          return (
            <g key={n} opacity={v.up ? 1 : 0.45}>
              <rect x={456} y={y0} width={136} height={60} rx={8} fill={disagree ? 'var(--bad-soft)' : 'var(--surface)'} stroke={disagree ? 'var(--bad)' : 'var(--border-strong)'} strokeWidth={disagree ? 2 : 1.2} />
              <text x={464} y={y0 + 17} style={{ fontSize: 11.5, fontWeight: 800 }}>
                {n}
                {params.mode === 'lamport' && v.up ? <tspan style={{ fontWeight: 500, fill: 'var(--muted)' }}>{`  clock ${v.clock}`}</tspan> : null}
              </text>
              <text x={464} y={y0 + 34} style={{ fontSize: 12, fontFamily: 'var(--f-mono)', fontWeight: 700, fill: v.owner ? (v.owner === 'u1' ? CLAIM_COLOR.m1 : CLAIM_COLOR.m2) : 'var(--muted)' }}>
                {v.up ? `ana → ${v.owner ?? '—'}` : 'DOWN'}
              </text>
              <text x={464} y={y0 + 51} className="viz-label" style={{ fontSize: 9.5, fontFamily: 'var(--f-mono)' }}>
                {v.pending.length ? `holding: ${v.pending.join(', ')}` : v.up ? `applied ${v.applied.length}/2` : ''}
              </text>
            </g>
          );
        })}

        <text x={8} y={276} className="viz-label">
          {(['m1', 'm2'] as ClaimId[]).map((c, k) => {
            const a = f.answers[c];
            return (
              <tspan key={c}>
                {k ? ' · ' : ''}
                {CLAIMS[c].user} was told:{' '}
                <tspan style={{ fontWeight: 800, fill: a ? (a.granted ? 'var(--good)' : 'var(--muted)') : 'var(--warn)' }}>{a ? `${a.granted ? '"ana is yours"' : '"taken"'} (t=${a.t})` : 'waiting…'}</tspan>
              </tspan>
            );
          })}
        </text>
        <text x={8} y={290} style={{ fontSize: 11.5, fontWeight: 800, fill: f.diverged ? 'var(--bad)' : f.stuck ? 'var(--warn)' : 'var(--text-2)' }}>
          {f.diverged ? 'Replicas DIVERGED: same commands, different order' : f.stuck ? 'STUCK: cannot hear a later timestamp from R2' : now >= 0 && final === f ? 'Replicas agree' : ''}
        </text>
      </svg>
    </VizFrame>
  );
}
