import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { BASE_TIMEOUT, N, simulate, type MsgView, type NodeView, type Params, type Role, type Scenario } from './sim';

const CX = 140;
const CY = 180;
const RING = 108;
const NR = 27;

const pos = (i: number) => {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
  return { x: CX + RING * Math.cos(a), y: CY + RING * Math.sin(a) };
};

const ROLE_STYLE: Record<Role, { fill: string; stroke: string; dash?: string }> = {
  leader: { fill: 'var(--good-soft)', stroke: 'var(--good)' },
  candidate: { fill: 'var(--warn-soft)', stroke: 'var(--warn)' },
  follower: { fill: 'var(--surface-2)', stroke: 'var(--border)' },
  down: { fill: 'var(--surface-2)', stroke: 'var(--muted)', dash: '4 3' },
};

function msgColor(m: MsgView) {
  if (m.dropped) return 'var(--muted)';
  if (m.kind === 'RV') return 'var(--warn)';
  if (m.kind === 'AE') return 'var(--accent)';
  return m.ok ? 'var(--good)' : 'var(--bad)';
}
function msgLabel(m: MsgView) {
  if (m.kind === 'RV') return 'vote?';
  if (m.kind === 'RVR') return m.ok ? 'yes' : 'no';
  if (m.kind === 'AE') return m.n ? `AE+${m.n}` : 'AE';
  return m.ok ? 'ack' : 'nack';
}

function Message({ m }: { m: MsgView }) {
  const a = pos(m.from);
  const b = pos(m.to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  // offset the two directions of a link so request and reply don't overlap
  const off = m.from < m.to ? 5 : -5;
  const ox = -uy * off;
  const oy = ux * off;
  const x1 = a.x + ux * (NR + 3) + ox;
  const y1 = a.y + uy * (NR + 3) + oy;
  const x2 = b.x - ux * (NR + 6) + ox;
  const y2 = b.y - uy * (NR + 6) + oy;
  const color = msgColor(m);
  const mx = x1 + (x2 - x1) * (m.dropped ? 0.5 : 0.62);
  const my = y1 + (y2 - y1) * (m.dropped ? 0.5 : 0.62);
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={m.dropped ? mx : x2}
        y2={m.dropped ? my : y2}
        stroke={color}
        strokeWidth={1.8}
        strokeDasharray={m.dropped ? '3 3' : undefined}
        markerEnd={m.dropped ? undefined : `url(#raft-arrow-${m.kind}-${m.ok ? 1 : 0})`}
      />
      {m.dropped ? (
        <text x={mx} y={my + 4} textAnchor="middle" fontSize={13} fontWeight={700} style={{ fill: 'var(--bad)' }}>
          ✕
        </text>
      ) : (
        <text x={mx + ox * 1.6} y={my + oy * 1.6 + 3} textAnchor="middle" fontSize={9} fontWeight={600} style={{ fill: color }}>
          {msgLabel(m)}
        </text>
      )}
    </g>
  );
}

function NodeDot({ n }: { n: NodeView }) {
  const { x, y } = pos(n.id);
  const st = ROLE_STYLE[n.role];
  const circ = 2 * Math.PI * (NR + 5);
  const frac = n.timerLen ? n.timerLeft / n.timerLen : 0;
  return (
    <g>
      {(n.role === 'follower' || n.role === 'candidate') && (
        <circle
          cx={x}
          cy={y}
          r={NR + 5}
          fill="none"
          stroke={n.timerLeft <= 2 ? 'var(--warn)' : 'var(--accent)'}
          strokeWidth={3}
          strokeDasharray={`${circ * frac} ${circ}`}
          transform={`rotate(-90 ${x} ${y})`}
          opacity={0.75}
          style={{ transition: 'stroke-dasharray 0.35s ease' }}
        />
      )}
      <circle
        cx={x}
        cy={y}
        r={NR}
        fill={st.fill}
        stroke={st.stroke}
        strokeWidth={n.role === 'leader' || n.role === 'candidate' ? 3 : 2}
        strokeDasharray={st.dash}
        style={{ transition: 'fill 0.35s ease, stroke 0.35s ease' }}
      />
      <text x={x} y={y - 3} textAnchor="middle" className="viz-node-label">
        S{n.id + 1}
      </text>
      <text x={x} y={y + 11} textAnchor="middle" fontSize={10} style={{ fill: 'var(--text-2)' }}>
        {n.role === 'down' ? 'crashed' : `term ${n.term}`}
      </text>
      {n.role === 'leader' && (
        <text x={x} y={y - NR - 9} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: 'var(--good)', stroke: 'var(--surface)', strokeWidth: 4, paintOrder: 'stroke' }}>
          LEADER
        </text>
      )}
      {n.role === 'candidate' && (
        <text x={x} y={y - NR - 9} textAnchor="middle" fontSize={10} fontWeight={700} style={{ fill: 'var(--warn)', stroke: 'var(--surface)', strokeWidth: 4, paintOrder: 'stroke' }}>
          candidate {n.votes}/5
        </text>
      )}
    </g>
  );
}

const LOG_X = 318;
const LOG_Y = 58;
const COL = 40;
const ROW = 50;

function LogTable({ nodes }: { nodes: NodeView[] }) {
  const maxLen = Math.max(5, ...nodes.map((n) => n.log.length));
  const cols = Math.min(maxLen, 6);
  return (
    <g>
      <text x={LOG_X} y={LOG_Y - 30} className="viz-label">
        log index →
      </text>
      {Array.from({ length: cols }, (_, k) => (
        <text key={k} x={LOG_X + 30 + k * COL + COL / 2 - 3} y={LOG_Y - 12} textAnchor="middle" className="viz-label">
          {k + 1}
        </text>
      ))}
      {nodes.map((n, r) => {
        const y = LOG_Y + r * ROW;
        return (
          <g key={n.id} opacity={n.role === 'down' ? 0.55 : 1}>
            <text x={LOG_X} y={y + 18} fontSize={12} fontWeight={700} style={{ fill: n.role === 'leader' ? 'var(--good)' : 'var(--text)' }}>
              S{n.id + 1}
            </text>
            <text x={LOG_X} y={y + 31} fontSize={9} style={{ fill: 'var(--text-2)' }}>
              c={n.commit}
            </text>
            {Array.from({ length: cols }, (_, k) => {
              const e = n.log[k];
              const cx = LOG_X + 30 + k * COL;
              const committed = k < n.commit;
              return (
                <g key={k}>
                  <rect
                    x={cx}
                    y={y}
                    width={COL - 6}
                    height={ROW - 12}
                    rx={5}
                    fill={!e ? 'none' : committed ? 'var(--good-soft)' : 'var(--surface-2)'}
                    stroke={!e ? 'var(--border)' : committed ? 'var(--good)' : 'var(--warn)'}
                    strokeDasharray={!e || !committed ? '3 2' : undefined}
                    strokeWidth={e ? 1.5 : 1}
                    style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
                  />
                  {e && (
                    <>
                      <text x={cx + (COL - 6) / 2} y={y + 15} textAnchor="middle" fontSize={11} fontWeight={700}>
                        t{e.term}
                      </text>
                      <text x={cx + (COL - 6) / 2} y={y + 29} textAnchor="middle" fontSize={9} style={{ fill: 'var(--text-2)' }}>
                        {e.cmd}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

export default function RaftViz() {
  const [params, setParams] = useState<Params>({ scenario: 'normal', seed: 3, spread: 5 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;

  const leaders = f.nodes.filter((n) => n.role === 'leader');
  const aria =
    `Tick ${f.tick}. ` +
    (leaders.length ? leaders.map((l) => `S${l.id + 1} leads term ${l.term}`).join('; ') : 'No leader') +
    '. ' +
    f.nodes.map((n) => `S${n.id + 1} ${n.role}, term ${n.term}, ${n.log.length} entries, commit ${n.commit}`).join('; ');

  // chord separating {S1,S2} from {S3,S4,S5}
  const chord = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: CX + (RING + 34) * Math.cos(a), y: CY + (RING + 34) * Math.sin(a) };
  };
  const p1 = chord(234);
  const p2 = chord(18);

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
              { value: 'normal', label: 'Normal election' },
              { value: 'crash', label: 'Leader crash → re-election' },
              { value: 'partition', label: 'Network partition' },
            ]}
            onChange={(scenario) => setParams((p) => ({ ...p, scenario }))}
          />
          <Slider label="Random seed" value={params.seed} min={1} max={20} onChange={(seed) => setParams((p) => ({ ...p, seed }))} />
          <Slider
            label="Election-timeout spread"
            value={params.spread}
            min={0}
            max={8}
            onChange={(spread) => setParams((p) => ({ ...p, spread }))}
            format={(v) => `${BASE_TIMEOUT}–${BASE_TIMEOUT + v} ticks`}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)' }} /> leader / vote yes / ack
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> candidate / RequestVote
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> AppendEntries · ring = election timer
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> refused
          <span className="viz-key" style={{ background: 'var(--good-soft)', border: '1px solid var(--good)' }} /> committed entry
          <span className="viz-key" style={{ background: 'var(--surface-2)', border: '1px dashed var(--warn)' }} /> uncommitted
        </>
      }
    >
      <svg viewBox="0 0 600 320" className="viz-svg" role="img" aria-label={aria}>
        <defs>
          {(['RV', 'RVR', 'AE', 'AER'] as const).flatMap((k) =>
            [0, 1].map((ok) => {
              const c = msgColor({ from: 0, to: 1, kind: k, ok: !!ok });
              return (
                <marker key={`${k}${ok}`} id={`raft-arrow-${k}-${ok}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" fill={c} />
                </marker>
              );
            }),
          )}
        </defs>
        <text x={8} y={18} className="viz-label">
          t = {f.tick} · majority = 3 of 5
        </text>
        {f.partition && (
          <g>
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="var(--bad)" strokeWidth={2} strokeDasharray="6 4" />
            <text x={p2.x - 4} y={p2.y + 16} textAnchor="end" fontSize={10} fontWeight={700} style={{ fill: 'var(--bad)' }}>
              partition
            </text>
          </g>
        )}
        {f.msgs.map((m, k) => (
          <Message key={k} m={m} />
        ))}
        {f.nodes.map((n) => (
          <NodeDot key={n.id} n={n} />
        ))}
        <LogTable nodes={f.nodes} />
      </svg>
    </VizFrame>
  );
}
