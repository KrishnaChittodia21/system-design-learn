import { useState } from 'react';
import { Choice, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, simulate, type Acks, type Params } from './sim';

const CELL_X = 132;
const CELL_W = 50;
const ROW_Y = (i: number) => 26 + i * 60;
const ROW_H = 40;
const MAX_CELLS = 7;

export default function KafkaIsrAcksViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const leader = f.replicas.find((r) => r.leader)!;
  const visible = leader.log.slice(0, f.hw);
  const hwX = CELL_X + f.hw * CELL_W - 2;
  const isr = f.replicas.filter((r) => r.alive && r.isr).map((r) => r.id);

  const aria = `Leader ${leader.id}. ISR {${isr.join(', ')}}. High watermark ${f.hw}. ${f.acked.length} messages acknowledged${
    f.lost.length ? `, ${f.lost.join(', ')} lost after being acknowledged` : ''
  }.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Acks>
            label="Producer acks"
            value={params.acks}
            options={[
              { value: '1', label: 'acks=1 (leader only)' },
              { value: 'all', label: 'acks=all (whole ISR)' },
            ]}
            onChange={(acks) => setParams((p) => ({ ...p, acks }))}
          />
          <Choice<'1' | '2'>
            label="min.insync.replicas"
            value={String(params.minIsr) as '1' | '2'}
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
            ]}
            onChange={(v) => setParams((p) => ({ ...p, minIsr: v === '1' ? 1 : 2 }))}
          />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--good)' }} /> committed (below HW)
          <span className="viz-key" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)' }} /> written, not yet committed
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> acked then lost / truncated
          <span>dashed line = high watermark</span>
        </>
      }
    >
      <svg viewBox="0 0 600 316" className="viz-svg" role="img" aria-label={aria}>
        {/* offset header */}
        {Array.from({ length: MAX_CELLS }, (_, o) => (
          <text key={o} x={CELL_X + o * CELL_W + (CELL_W - 4) / 2} y={16} textAnchor="middle" fontSize={9.5} style={{ fill: 'var(--muted)' }}>
            offset {o}
          </text>
        ))}

        {f.replicas.map((r, i) => {
          const y = ROW_Y(i);
          const fetching = f.fetchers.includes(i);
          const cut = f.truncated.filter((t) => t[0] === i);
          const tone = !r.alive ? 'bad' : r.leader ? 'accent' : r.isr ? 'good' : 'warn';
          return (
            <g key={r.id}>
              <rect
                x={8}
                y={y}
                width={114}
                height={ROW_H}
                rx={8}
                fill={`var(--${tone}-soft)`}
                stroke={`var(--${tone})`}
                strokeWidth={r.leader || !r.alive ? 2 : 1.2}
                strokeDasharray={!r.alive ? '4 3' : undefined}
                style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
              />
              <text x={16} y={y + 17} fontSize={12.5} fontWeight={700}>
                {r.id} {r.leader ? '· leader' : r.alive ? '· follower' : ''}
              </text>
              <text x={16} y={y + 32} fontSize={10} style={{ fill: `var(--${tone})` }} fontWeight={600}>
                {!r.alive ? 'crashed ✕' : r.isr ? 'in ISR' : 'out of ISR (lagging)'}
              </text>
              {Array.from({ length: MAX_CELLS }, (_, o) => {
                const label = r.log[o];
                const committed = label !== undefined && o < f.hw && r.alive;
                const isFresh = f.fresh.some(([ri, oo]) => ri === i && oo === o);
                const lostCell = label !== undefined && f.lost.includes(label) && r.alive;
                return (
                  <g key={o}>
                    <rect
                      x={CELL_X + o * CELL_W}
                      y={y + 4}
                      width={CELL_W - 4}
                      height={ROW_H - 8}
                      rx={5}
                      fill={label === undefined ? 'var(--surface)' : lostCell ? 'var(--bad-soft)' : committed ? 'var(--good)' : 'var(--accent-soft)'}
                      stroke={isFresh ? 'var(--accent)' : label === undefined ? 'var(--border)' : committed ? 'var(--good)' : 'var(--accent)'}
                      strokeWidth={isFresh ? 2.6 : 1}
                      strokeDasharray={label === undefined ? '3 3' : undefined}
                      opacity={r.alive ? 1 : 0.55}
                      style={{ transition: 'fill 0.3s ease, stroke 0.3s ease' }}
                    />
                    {label !== undefined && (
                      <text
                        x={CELL_X + o * CELL_W + (CELL_W - 4) / 2}
                        y={y + ROW_H / 2 + 4}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={700}
                        style={{ fill: committed ? 'var(--surface)' : lostCell ? 'var(--bad)' : 'var(--accent)' }}
                      >
                        {label}
                      </text>
                    )}
                  </g>
                );
              })}
              {cut.length > 0 && (
                <text x={CELL_X + r.log.length * CELL_W + 4} y={y + ROW_H / 2 + 4} fontSize={10.5} fontWeight={700} style={{ fill: 'var(--bad)' }}>
                  ✂ {cut.map((c) => c[1]).join(', ')} truncated
                </text>
              )}
              <text x={CELL_X + MAX_CELLS * CELL_W + 4} y={y + 17} fontSize={10} style={{ fill: 'var(--text-2)' }}>
                LEO {r.log.length}
              </text>
              {fetching && (
                <text x={CELL_X + MAX_CELLS * CELL_W + 4} y={y + 32} fontSize={10} fontWeight={700} style={{ fill: 'var(--accent)' }}>
                  ← fetched
                </text>
              )}
            </g>
          );
        })}

        {/* high watermark */}
        <line x1={hwX} y1={20} x2={hwX} y2={ROW_Y(2) + ROW_H + 6} stroke="var(--good)" strokeWidth={2} strokeDasharray="5 3" style={{ transition: 'x1 0.3s ease, x2 0.3s ease' }} />
        <text x={hwX} y={ROW_Y(2) + ROW_H + 18} textAnchor="middle" fontSize={10.5} fontWeight={700} style={{ fill: 'var(--good)' }}>
          HW = {f.hw}
        </text>

        {/* producer */}
        <rect
          x={8}
          y={222}
          width={290}
          height={88}
          rx={8}
          fill={f.refused ? 'var(--bad-soft)' : 'var(--surface-2)'}
          stroke={f.refused ? 'var(--bad)' : 'var(--border)'}
          strokeWidth={f.refused ? 2 : 1.2}
        />
        <text x={16} y={239} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          producer · acks={params.acks}
          {params.acks === 'all' ? ` · min ISR ${params.minIsr}` : ''}
        </text>
        <text x={16} y={258} fontSize={11}>
          acked: <tspan fontWeight={700}>{f.acked.join(' ') || '—'}</tspan>
        </text>
        <text x={16} y={276} fontSize={11} style={{ fill: f.pending.length ? 'var(--warn)' : 'var(--text-2)' }}>
          waiting for ISR: {f.pending.join(' ') || '—'}
        </text>
        <text x={16} y={296} fontSize={11} fontWeight={700} style={{ fill: f.refused ? 'var(--bad)' : f.lost.length ? 'var(--bad)' : 'var(--muted)' }}>
          {f.refused ? `NotEnoughReplicas: ${f.refused} refused` : f.lost.length ? `acked but lost: ${f.lost.join(' ')}` : 'no acked data lost'}
        </text>

        {/* consumer */}
        <rect x={308} y={222} width={284} height={88} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
        <text x={316} y={239} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          consumer (reads below HW from {leader.id})
        </text>
        {visible.map((m, k) => (
          <g key={k}>
            <rect x={316 + k * 38} y={250} width={34} height={22} rx={4} fill="var(--good-soft)" stroke="var(--good)" />
            <text x={316 + k * 38 + 17} y={265} textAnchor="middle" fontSize={11} fontWeight={700}>
              {m}
            </text>
          </g>
        ))}
        {visible.length === 0 && (
          <text x={316} y={265} fontSize={11} style={{ fill: 'var(--muted)' }}>
            nothing committed yet
          </text>
        )}
        <text x={316} y={296} className="viz-label" style={{ fontSize: 10.5 }}>
          uncommitted writes stay invisible to readers
        </text>
      </svg>
    </VizFrame>
  );
}
