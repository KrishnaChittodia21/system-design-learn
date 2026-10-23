import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { DEFAULT_PARAMS, KEY, ME, TOP, simulate, type Params, type Tie } from './sim';

const ROW_H = 33;
const LIST_Y = 30;
const BAR_X = 108;
const BAR_MAX = 170;
const MAX_PTS = 8;

export default function LeaderboardZsetViz() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const r = f.myRank;
  const neighbours = f.order.slice(Math.max(0, r - 1), r + 2);
  const sqlW = 220;
  const zW = Math.max(4, (Math.log10(f.zsetHops) / Math.log10(f.sqlRows)) * sqlW);

  const aria = `Leaderboard: ${f.order.map((e, i) => `${i + 1}. ${e.member} ${e.points}`).join(', ')}. Your rank ${r + 1}.`;

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Tie>
            label="Tie-break"
            value={params.tie}
            options={[
              { value: 'member', label: 'Member name (Redis default)' },
              { value: 'time', label: 'Earlier achiever (composite score)' },
            ]}
            onChange={(tie) => setParams((p) => ({ ...p, tie }))}
          />
          <Slider label="Players this month" value={params.players} min={1} max={25} onChange={(players) => setParams((p) => ({ ...p, players }))} format={(v) => `${v}M`} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> just scored
          <span className="viz-key ring" /> you ({ME})
          <span className="viz-key" style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn)' }} /> tied on points
          <span>top {TOP} band shaded</span>
        </>
      }
    >
      <svg viewBox="0 0 600 310" className="viz-svg" role="img" aria-label={aria}>
        <text x={8} y={16} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          {KEY} · ZREVRANGE 0 -1 (sample of 8)
        </text>
        <rect x={4} y={LIST_Y - 3} width={330} height={TOP * ROW_H} rx={8} fill="var(--good-soft)" />

        {f.order.map((e, i) => {
          const moved = e.member === f.moved;
          const me = e.member === ME;
          const tied = f.ties.includes(e.member);
          return (
            <g key={e.member} style={{ transform: `translate(0px, ${LIST_Y + i * ROW_H}px)`, transition: 'transform 0.45s ease' }}>
              <rect
                x={8}
                y={0}
                width={322}
                height={ROW_H - 6}
                rx={6}
                fill={moved ? 'var(--accent-soft)' : 'var(--surface)'}
                stroke={me ? 'var(--text)' : moved ? 'var(--accent)' : 'var(--border)'}
                strokeWidth={me ? 2 : moved ? 2 : 1}
              />
              <text x={18} y={18} fontSize={11} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
                #{i + 1}
              </text>
              <text x={50} y={18} fontSize={12} fontWeight={me ? 800 : 600}>
                {e.member}
                {me && (
                  <tspan fontSize={9.5} fontWeight={600} style={{ fill: 'var(--accent)' }}>
                    {' '}
                    you
                  </tspan>
                )}
              </text>
              <rect x={BAR_X} y={7} width={(e.points / MAX_PTS) * BAR_MAX} height={13} rx={3} fill={moved ? 'var(--accent)' : tied ? 'var(--warn-soft)' : 'var(--accent-soft)'} stroke={tied ? 'var(--warn)' : 'none'} style={{ transition: 'width 0.35s ease' }} />
              <text x={BAR_X + (e.points / MAX_PTS) * BAR_MAX + 6} y={18} fontSize={11} fontWeight={700}>
                {e.points}
              </text>
              <text x={324} y={18} textAnchor="end" fontSize={9.5} style={{ fill: tied ? 'var(--warn)' : 'var(--muted)' }}>
                {params.tie === 'time' ? `@${e.at}s` : tied ? 'tie' : ''}
              </text>
            </g>
          );
        })}

        {/* command */}
        <rect x={344} y={6} width={248} height={52} rx={8} fill="var(--surface-2)" stroke={f.moved ? 'var(--accent)' : 'var(--border)'} strokeWidth={f.moved ? 2 : 1.2} />
        <text x={352} y={22} fontSize={10} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          last command
        </text>
        <text x={352} y={42} fontSize={10} fontFamily="var(--f-mono)" fontWeight={600} style={{ fill: 'var(--accent)' }}>
          {f.op.length > 40 ? `${f.op.slice(0, 39)}…` : f.op}
        </text>

        {/* top-k */}
        <rect x={344} y={66} width={248} height={70} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
        <text x={352} y={82} fontSize={10} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          ZREVRANGE {KEY} 0 {TOP - 1} → top {TOP}
        </text>
        {f.order.slice(0, TOP).map((e, i) => (
          <text key={e.member} x={352 + i * 80} y={112} fontSize={12} fontWeight={700} style={{ fill: e.member === ME ? 'var(--accent)' : 'var(--text)' }}>
            {['①', '②', '③'][i]} {e.member}
            <tspan fontSize={10} fontWeight={400} dx={3} style={{ fill: 'var(--text-2)' }}>
              {e.points}
            </tspan>
          </text>
        ))}
        <text x={352} y={128} className="viz-label" style={{ fontSize: 9.5 }}>
          O(log n + k): skip list walk from the top
        </text>

        {/* my rank */}
        <rect x={344} y={144} width={248} height={76} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
        <text x={352} y={160} fontSize={10} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          ZREVRANK {KEY} {ME} → {r} (rank #{r + 1})
        </text>
        <text x={352} y={176} className="viz-label" style={{ fontSize: 9.5 }}>
          neighbours: ZREVRANGE {Math.max(0, r - 1)} {r + 1}
        </text>
        {neighbours.map((e, i) => (
          <text key={e.member} x={352 + i * 80} y={204} fontSize={12} fontWeight={e.member === ME ? 800 : 500} style={{ fill: e.member === ME ? 'var(--accent)' : 'var(--text)' }}>
            #{f.order.indexOf(e) + 1} {e.member}
          </text>
        ))}

        {/* cost */}
        <rect x={344} y={228} width={248} height={76} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
        <text x={352} y={244} fontSize={10} fontWeight={700} style={{ fill: 'var(--text-2)' }}>
          cost of "what is my rank?" (log scale)
        </text>
        <rect x={352} y={252} width={sqlW} height={12} rx={3} fill="var(--bad-soft)" stroke="var(--bad)" />
        <text x={356} y={262} fontSize={9.5} fontWeight={700} style={{ fill: 'var(--bad)' }}>
          SQL COUNT(*) scan: ~{f.sqlRows.toLocaleString('en-US')} rows
        </text>
        <rect x={352} y={276} width={zW} height={12} rx={3} fill="var(--good)" style={{ transition: 'width 0.3s ease' }} />
        <text x={352 + zW + 6} y={286} fontSize={9.5} fontWeight={700} style={{ fill: 'var(--good)' }}>
          ZREVRANK: ~{f.zsetHops} skip-list hops
        </text>
        <text x={8} y={302} className="viz-label" style={{ fontSize: 10 }}>
          {params.tie === 'time' ? 'score = pts·2³² + (2³²−1−secs into month)' : 'equal scores: ordered by name, Z before A'}
        </text>
      </svg>
    </VizFrame>
  );
}
