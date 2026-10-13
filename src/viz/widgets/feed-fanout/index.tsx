import { useState } from 'react';
import { Choice, Slider, VizFrame, useFrames, useSimulation } from '../../core';
import { meta } from './meta';
import { CELEB_THRESHOLD, YOU_FOLLOW, authors, fmt, pushes, readCost, simulate, type Params, type Strategy } from './sim';

const FOLLOWER_STEPS = [1_000, 10_000, 100_000, 1_000_000, 10_000_000, 50_000_000];
const LOG_MAX = 9; // log10 scale for the write bars (up to 1B)

const CARD_W = 136;
const cardX = (i: number) => 10 + i * 148;

export default function FeedFanoutViz() {
  const [params, setParams] = useState<Params>({ strategy: 'push', celebFollowers: 10_000_000, rounds: 3 });
  const frames = useSimulation(simulate, params);
  const stepper = useFrames(frames);
  const f = stepper.frame;
  const list = authors(params.celebFollowers);
  const ev = f.event;
  const rc = readCost(params.strategy, list);
  const activeAuthor = ev.type === 'post' ? ev.author : -1;

  const ariaLabel = `${params.strategy} strategy: ${fmt(f.timelineWrites)} timeline writes and ${fmt(f.readQueries)} read lookups so far after ${f.feedOpens} feed opens.`;

  const tlBox = { x: 10, y: 112, w: 372, h: 118 };
  const feedBox = { x: 398, y: 112, w: 192, h: 206 };

  return (
    <VizFrame
      title={meta.title}
      blurb={meta.blurb}
      stepper={stepper}
      controls={
        <>
          <Choice<Strategy>
            label="Strategy"
            value={params.strategy}
            options={[
              { value: 'push', label: 'Fan-out on write' },
              { value: 'pull', label: 'Fan-out on read' },
              { value: 'hybrid', label: 'Hybrid' },
            ]}
            onChange={(strategy) => setParams((p) => ({ ...p, strategy }))}
          />
          <Slider
            label="Celebrity followers"
            value={Math.max(0, FOLLOWER_STEPS.indexOf(params.celebFollowers))}
            min={0}
            max={FOLLOWER_STEPS.length - 1}
            onChange={(i) => setParams((p) => ({ ...p, celebFollowers: FOLLOWER_STEPS[i] }))}
            format={(i) => fmt(FOLLOWER_STEPS[i])}
          />
          <Slider label="Posting rounds" value={params.rounds} min={2} max={5} onChange={(rounds) => setParams((p) => ({ ...p, rounds }))} />
        </>
      }
      legend={
        <>
          <span className="viz-key" style={{ background: 'var(--accent)' }} /> pushed into timelines at write time
          <span className="viz-key" style={{ background: 'var(--warn)' }} /> merged at read time
          <span className="viz-key" style={{ background: 'var(--bad)' }} /> celebrity-sized write burst
        </>
      }
    >
      <svg viewBox="0 0 600 326" className="viz-svg" role="img" aria-label={ariaLabel}>
        <defs>
          {['accent', 'warn', 'bad'].map((c) => (
            <marker key={c} id={`ff-arrow-${c}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={`var(--${c})`} />
            </marker>
          ))}
        </defs>

        {/* author cards */}
        {list.map((a, i) => {
          const pushed = pushes(params.strategy, a);
          const active = activeAuthor === i;
          const pulledNow = ev.type === 'read' && !pushed;
          return (
            <g key={a.id}>
              <rect
                x={cardX(i)}
                y={8}
                width={CARD_W}
                height={64}
                rx={8}
                fill={active ? 'var(--accent-soft)' : pulledNow ? 'var(--warn-soft)' : 'var(--surface-2)'}
                stroke={active ? 'var(--accent)' : pulledNow ? 'var(--warn)' : 'var(--border)'}
                strokeWidth={active || pulledNow ? 2.5 : 1.5}
              />
              <text x={cardX(i) + 10} y={27} fontSize={12.5} fontWeight={700}>
                {a.name}
              </text>
              <text x={cardX(i) + 10} y={44} fontSize={11} className="viz-label">
                {fmt(a.followers)} followers
              </text>
              <text x={cardX(i) + 10} y={62} fontSize={10.5} className="viz-label">
                {pushed ? 'push' : 'pull'} · {f.postsBy[i]} post{f.postsBy[i] === 1 ? '' : 's'} stored
              </text>
            </g>
          );
        })}

        {/* timeline cache with per-author write bars */}
        <rect x={tlBox.x} y={tlBox.y} width={tlBox.w} height={tlBox.h} rx={8} fill="var(--surface-2)" stroke="var(--border)" />
        <text x={tlBox.x + 10} y={tlBox.y + 17} fontSize={11.5} fontWeight={700}>
          Follower timeline cache: inserts so far (log scale)
        </text>
        {list.map((a, i) => {
          const w = f.writesBy[i];
          const bw = w > 0 ? (Math.log10(1 + w) / LOG_MAX) * 220 : 0;
          const y = tlBox.y + 30 + i * 21;
          const big = w >= CELEB_THRESHOLD;
          return (
            <g key={a.id}>
              <text x={tlBox.x + 10} y={y + 11} fontSize={10.5}>
                {a.name}
              </text>
              <rect x={tlBox.x + 70} y={y} width={220} height={14} rx={3} fill="var(--surface)" stroke="var(--border)" />
              <rect
                x={tlBox.x + 70}
                y={y}
                width={bw}
                height={14}
                rx={3}
                fill={big ? 'var(--bad)' : 'var(--accent)'}
                opacity={activeAuthor === i ? 1 : 0.7}
                style={{ transition: 'width 0.35s ease' }}
              />
              <text x={tlBox.x + 296} y={y + 11} fontSize={10.5} fontWeight={700}>
                {fmt(w)}
              </text>
            </g>
          );
        })}

        {/* write arrow for the current post */}
        {ev.type === 'post' && (
          <g>
            <line
              x1={cardX(ev.author) + CARD_W / 2}
              y1={74}
              x2={Math.min(cardX(ev.author) + CARD_W / 2, 330)}
              y2={tlBox.y - 2}
              stroke={ev.pushed ? (ev.writes >= CELEB_THRESHOLD ? 'var(--bad)' : 'var(--accent)') : 'var(--muted)'}
              strokeWidth={ev.pushed ? 2.5 : 1.2}
              strokeDasharray={ev.pushed ? undefined : '4 3'}
              markerEnd={ev.pushed ? `url(#ff-arrow-${ev.writes >= CELEB_THRESHOLD ? 'bad' : 'accent'})` : undefined}
            />
            <text x={Math.min(cardX(ev.author) + CARD_W / 2, 330) + 8} y={98} fontSize={11} fontWeight={700} style={{ fill: ev.pushed ? 'var(--text)' : 'var(--text-2)' }}>
              {ev.pushed ? `+${fmt(ev.writes)} inserts` : 'no fan-out (1 write)'}
            </text>
          </g>
        )}

        {/* read arrows */}
        {ev.type === 'read' && (
          <g>
            {ev.timeline > 0 && (
              <line x1={feedBox.x - 2} y1={feedBox.y + 50} x2={tlBox.x + tlBox.w + 2} y2={tlBox.y + 50} stroke="var(--accent)" strokeWidth={2.5} markerEnd="url(#ff-arrow-accent)" />
            )}
            {list.map((a, i) =>
              !pushes(params.strategy, a) ? (
                <line
                  key={a.id}
                  x1={feedBox.x + feedBox.w / 2}
                  y1={feedBox.y - 2}
                  x2={cardX(i) + CARD_W / 2}
                  y2={74}
                  stroke="var(--warn)"
                  strokeWidth={2}
                  markerEnd="url(#ff-arrow-warn)"
                />
              ) : null,
            )}
            {params.strategy === 'pull' && (
              <text
                x={feedBox.x - 8}
                y={104}
                fontSize={10.5}
                fontWeight={700}
                textAnchor="end"
                style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 4, strokeLinejoin: 'round' }}
              >
                + {YOU_FOLLOW - list.length} more followees queried
              </text>
            )}
          </g>
        )}

        {/* your feed */}
        <rect
          x={feedBox.x}
          y={feedBox.y}
          width={feedBox.w}
          height={feedBox.h}
          rx={8}
          fill={ev.type === 'read' ? 'var(--accent-soft)' : 'var(--surface-2)'}
          stroke={ev.type === 'read' ? 'var(--accent)' : 'var(--border)'}
          strokeWidth={ev.type === 'read' ? 2.5 : 1.5}
        />
        <text x={feedBox.x + 10} y={feedBox.y + 17} fontSize={11.5} fontWeight={700}>
          Your feed (you follow {YOU_FOLLOW})
        </text>
        <text x={feedBox.x + 10} y={feedBox.y + 32} fontSize={9.5} className="viz-label">
          per open: {[rc.timeline ? `${rc.timeline} timeline` : '', rc.outbox ? `${rc.outbox} list${rc.outbox === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ')} = {rc.timeline + rc.outbox} lookup{rc.timeline + rc.outbox === 1 ? '' : 's'}
        </text>
        {f.feed.length === 0 && (
          <text x={feedBox.x + 10} y={feedBox.y + 56} fontSize={10.5} className="viz-label">
            not opened yet
          </text>
        )}
        {f.feed.map((it, k) => (
          <g key={it.post}>
            <rect
              x={feedBox.x + 10}
              y={feedBox.y + 42 + k * 20}
              width={feedBox.w - 20}
              height={16}
              rx={4}
              fill={it.via === 'timeline' ? 'var(--accent-soft)' : 'var(--warn-soft)'}
              stroke={it.via === 'timeline' ? 'var(--accent)' : 'var(--warn)'}
            />
            <text x={feedBox.x + 18} y={feedBox.y + 54 + k * 20} fontSize={10.5}>
              post {it.post} · {it.via === 'timeline' ? 'precomputed' : 'merged at read'}
            </text>
          </g>
        ))}

        {/* totals */}
        {[
          { label: 'timeline writes', value: fmt(f.timelineWrites), tone: f.timelineWrites >= CELEB_THRESHOLD ? 'bad' : 'accent' },
          { label: 'read lookups', value: fmt(f.readQueries), tone: f.feedOpens && f.readQueries / f.feedOpens > 10 ? 'warn' : 'accent' },
          { label: 'feed opens', value: String(f.feedOpens), tone: 'muted' },
        ].map((s, k) => (
          <g key={s.label}>
            <rect x={10 + k * 126} y={242} width={118} height={76} rx={8} fill="var(--surface-2)" stroke={`var(--${s.tone})`} strokeWidth={1.5} />
            <text x={10 + k * 126 + 59} y={278} textAnchor="middle" fontSize={22} fontWeight={800}>
              {s.value}
            </text>
            <text x={10 + k * 126 + 59} y={302} textAnchor="middle" fontSize={10.5} className="viz-label">
              {s.label}
            </text>
          </g>
        ))}
      </svg>
    </VizFrame>
  );
}
