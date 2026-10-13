import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { simulate, type FailAt, type Lane, type MsgKind, type Params, type Tone } from './sim';

const LANES: Lane[] = ['coord', 'order', 'inventory', 'payment'];
const LANE_Y: Record<Lane, number> = { coord: 44, order: 104, inventory: 164, payment: 224 };
const X0 = 104;
const X1 = 588;

const MSG_COLOR: Record<MsgKind, string> = {
  cmd: 'var(--accent)',
  decision: 'var(--accent)',
  ok: 'var(--good)',
  fail: 'var(--bad)',
  comp: 'var(--warn)',
};
const TONE_FILL: Record<Tone, string> = {
  idle: 'var(--surface-2)',
  busy: 'var(--accent-soft)',
  good: 'var(--good-soft)',
  bad: 'var(--bad-soft)',
  warn: 'var(--warn-soft)',
};
const TONE_STROKE: Record<Tone, string> = {
  idle: 'var(--border)',
  busy: 'var(--accent)',
  good: 'var(--good)',
  bad: 'var(--bad)',
  warn: 'var(--warn)',
};

export default function SagaVs2pcViz() {
  const [params, setParams] = useState<Params>({ protocol: '2pc', fail: 'none', crash: true });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const tMax = frames[frames.length - 1].tick + 1;
  const dx = (X1 - X0) / tMax;
  const x = (t: number) => X0 + t * dx;
  const coordName = params.protocol === '2pc' ? 'Coordinator' : 'Orchestrator';
  const names: Record<Lane, string> = { coord: coordName, order: 'Order', inventory: 'Inventory', payment: 'Payment' };

  const failOptions: { value: FailAt; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'inventory', label: 'Inventory' },
    { value: 'payment', label: 'Payment' },
    ...(params.protocol === 'saga' ? [{ value: 'confirm' as FailAt, label: 'Confirm (after pivot)' }] : []),
  ];

  const lockCount = f.spans.filter((s) => s.to === null && (s.kind === 'lock' || s.kind === 'doubt')).length;
  const ariaLabel = `${params.protocol === '2pc' ? 'Two-phase commit' : 'Saga'} at step ${stepper.i + 1}: ${LANES.map(
    (l) => `${names[l]} ${f.status[l].text}`,
  ).join('; ')}. ${lockCount} participant lock(s) held.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice
            label="Protocol"
            value={params.protocol}
            options={[
              { value: '2pc', label: 'Two-phase commit' },
              { value: 'saga', label: 'Orchestrated saga' },
            ]}
            onChange={(protocol) =>
              setParams((p) => ({ ...p, protocol, fail: protocol === '2pc' && p.fail === 'confirm' ? 'none' : p.fail }))
            }
          />
          <Choice label="Failing step" value={params.fail} options={failOptions} onChange={(fail) => setParams((p) => ({ ...p, fail }))} />
          <Choice
            label={params.protocol === '2pc' ? 'Coordinator crash' : 'Orchestrator crash'}
            value={params.crash ? 'yes' : 'no'}
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: params.protocol === '2pc' ? 'After votes' : 'After step 2' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, crash: v === 'yes' }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> command / decision
          <span className="viz-key" style={{ background: 'var(--good)' }} /> OK / vote YES
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> failure / vote NO
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> compensation
          <span className="viz-key" style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn)', borderRadius: 2 }} /> lock held
          <span className="viz-key" style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad)', borderRadius: 2 }} /> in doubt
        </>
      }
    >
      <svg viewBox="0 0 600 316" className="viz-svg" role="img" aria-label={ariaLabel}>
        <defs>
          {(Object.keys(MSG_COLOR) as MsgKind[]).map((k) => (
            <marker key={k} id={`s2p-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={MSG_COLOR[k]} />
            </marker>
          ))}
        </defs>

        {/* time cursor */}
        <rect x={x(f.tick) - dx * 0.1} y={18} width={dx * 1.0} height={232} fill="var(--accent-soft)" opacity={0.6} />
        <text x={X0} y={12} className="viz-label">
          time →
        </text>

        {/* lanes */}
        {LANES.map((l) => (
          <g key={l}>
            <line x1={X0} x2={X1} y1={LANE_Y[l]} y2={LANE_Y[l]} stroke="var(--border)" strokeWidth={2} />
            <text x={8} y={LANE_Y[l] + 4} className="viz-node-label">
              {names[l]}
            </text>
          </g>
        ))}

        {/* spans: locks, in-doubt, coordinator down */}
        {f.spans.map((s, k) => {
          const end = s.to ?? f.tick + 0.9;
          const w = Math.max(4, x(end) - x(s.from));
          if (s.kind === 'down')
            return (
              <rect key={k} x={x(s.from)} y={LANE_Y[s.lane] - 9} width={w} height={18} fill="var(--bad-soft)" stroke="var(--bad)" strokeDasharray="4 3" rx={3} />
            );
          return (
            <rect
              key={k}
              x={x(s.from)}
              y={LANE_Y[s.lane] - 8}
              width={w}
              height={16}
              rx={3}
              fill={s.kind === 'doubt' ? 'var(--bad-soft)' : 'var(--warn-soft)'}
              stroke={s.kind === 'doubt' ? 'var(--bad)' : 'var(--warn)'}
              strokeWidth={1.5}
            >
              <title>{s.kind === 'doubt' ? 'in doubt: locks held' : 'lock held'}</title>
            </rect>
          );
        })}

        {/* messages */}
        {f.msgs.map((m, k) => {
          const current = m.t === f.tick;
          const x1 = x(m.t);
          const x2 = x(m.t) + dx * 0.8;
          const y1 = LANE_Y[m.from];
          const y2 = LANE_Y[m.to];
          const toParticipant = m.to !== 'coord';
          const lx = toParticipant ? x2 + 3 : x1 + 4;
          const ly = toParticipant ? y2 - 6 : y1 - 10;
          return (
            <g key={k} opacity={current ? 1 : 0.35}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2 + (y2 > y1 ? -3 : 3)}
                stroke={MSG_COLOR[m.kind]}
                strokeWidth={current ? 2.2 : 1.4}
                markerEnd={`url(#s2p-arrow-${m.kind})`}
              />
              {current && (
                <text x={lx} y={ly} fontSize={10.5} fontWeight={700} style={{ fill: MSG_COLOR[m.kind] }}>
                  {m.label}
                </text>
              )}
            </g>
          );
        })}

        {/* marks */}
        {f.marks.map((m, k) => {
          const cx = x(m.t);
          const cy = LANE_Y[m.lane];
          const current = m.t === f.tick;
          const label = current || m.kind === 'crash' || m.kind === 'gap';
          let glyph;
          if (m.kind === 'crash')
            glyph = <text x={cx} y={cy + 6} textAnchor="middle" fontSize={20} fontWeight={800} style={{ fill: 'var(--bad)' }}>✕</text>;
          else if (m.kind === 'gap') glyph = null;
          else if (m.kind === 'log') glyph = <rect x={cx - 4} y={cy - 4} width={8} height={8} fill="var(--text-2)" />;
          else if (m.kind === 'blocked')
            glyph = <path d={`M${cx},${cy - 7} L${cx + 7},${cy + 6} L${cx - 7},${cy + 6} z`} fill="var(--warn)" />;
          else
            glyph = (
              <circle
                cx={cx}
                cy={cy}
                r={5}
                fill={m.kind === 'commit' ? 'var(--good)' : m.kind === 'abort' ? 'var(--bad)' : 'var(--accent)'}
                stroke="var(--surface)"
                strokeWidth={1.5}
              />
            );
          return (
            <g key={k} opacity={current ? 1 : 0.6}>
              {glyph}
              {label && (
                <text
                  x={m.kind === 'gap' ? cx - dx * 1.5 : cx}
                  y={m.kind === 'gap' ? cy - 14 : cy + 20}
                  textAnchor="middle"
                  fontSize={10}
                  className="viz-label"
                >
                  {m.label}
                </text>
              )}
            </g>
          );
        })}

        {/* status chips */}
        {LANES.map((l, k) => {
          const st = f.status[l];
          return (
            <g key={l}>
              <rect x={4 + k * 149} y={266} width={143} height={44} rx={8} fill={TONE_FILL[st.tone]} stroke={TONE_STROKE[st.tone]} strokeWidth={1.5} />
              <text x={12 + k * 149} y={282} fontSize={11} fontWeight={700}>
                {names[l]}
              </text>
              <text x={12 + k * 149} y={300} fontSize={11}>
                {st.text}
              </text>
            </g>
          );
        })}
      </svg>
    </VizFrame>
  );
}
